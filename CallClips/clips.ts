/*
 * CallClips – making clips and everything done with them afterwards (list, rename, trim, delete, send).
 * The files in Downloads\Call Clips are the truth; where a clip was made (call, server) is kept in a DataStore next
 * to them and simply missing for files added by hand.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { PluginNative } from "@utils/types";
import type { Channel } from "@vencord/discord-types";
import { ChannelStore, DraftType, GuildStore, PermissionsBits, PermissionStore, RestAPI, SelectedChannelStore, UploadHandler } from "@webpack/common";

import { notify } from "../_ui";
import { sendFiles } from "../ChatPopout/upload";
import { decode, encode, RATE } from "./encode";
import { settings } from "./index";
import type { ClipFile } from "./native";
import { MicMode, take } from "./recorder";
import { openClipsWindow } from "./ui";

const Native = VencordNative.pluginHelpers.CallClips as PluginNative<typeof import("./native")>;
const logger = new Logger("CallClips");
const META_KEY = "CallClips_meta";

export interface ClipMeta {
    /** Where it was clipped, e.g. "General · My Server" */
    where?: string;
    seconds?: number;
    created?: number;
    /** Uploaded to a server's soundboard – played in calls from there */
    sound?: ClipSound;
}

export interface ClipSound {
    guildId: string;
    soundId: string;
}

export interface Clip extends ClipFile, ClipMeta { }

// ---------------------------------------------------------------- List (shared by every open window)

export const clipState = { clips: [] as Clip[], loaded: false, busy: false };
export const clipListeners = new Set<() => void>();
const emit = () => clipListeners.forEach(l => l());

let meta: Record<string, ClipMeta> | null = null;
const loadMeta = async () => meta ??= (await DataStore.get<Record<string, ClipMeta>>(META_KEY)) ?? {};
const saveMeta = () => DataStore.set(META_KEY, meta);

export async function refresh() {
    try {
        const files = await Native.listClips();
        const m = await loadMeta();
        clipState.clips = files.map(f => ({ ...m[f.file], ...f }));
        // Forget clips deleted outside Discord
        const present = new Set(files.map(f => f.file));
        let changed = false;
        for (const file of Object.keys(m)) if (!present.has(file)) { delete m[file]; changed = true; }
        if (changed) await saveMeta();
    } catch (e) {
        logger.error("Could not list clips", e);
    } finally {
        clipState.loaded = true;
        emit();
    }
}

// ---------------------------------------------------------------- Clipping

function whereNow() {
    const channel = ChannelStore.getChannel(SelectedChannelStore.getVoiceChannelId() ?? "");
    if (!channel) return undefined;
    if (!channel.guild_id) return channel.name || "Call";
    const guild = GuildStore.getGuild(channel.guild_id);
    return guild ? `${channel.name} · ${guild.name}` : channel.name;
}

const pad = (n: number) => String(n).padStart(2, "0");
function defaultName(date: Date) {
    return `Clip ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}

/** Saves the last N seconds of the call. Returns the clip, or null if there's nothing to clip. */
export async function makeClip(): Promise<Clip | null> {
    if (clipState.busy) return null;
    const { seconds, micMode } = settings.store;
    const tracks = take(seconds, micMode as MicMode);
    if (!tracks) {
        notify({ title: "Nothing to clip yet", body: "Clips are recorded while you're in a voice call.", kind: "attention", app: "CallClips" });
        return null;
    }
    clipState.busy = true;
    emit();
    try {
        const { data, ext } = await encode(tracks);
        const now = new Date();
        const file = await Native.saveClip(defaultName(now), ext, data);
        const info: ClipMeta = { where: whereNow(), seconds: tracks[0].length / RATE, created: now.getTime() };
        (await loadMeta())[file] = info;
        await saveMeta();
        await refresh();
        const clip = clipState.clips.find(c => c.file === file) ?? null;
        notify({
            title: "Clip saved",
            body: `Last ${Math.round(info.seconds!)} s${info.where ? ` · ${info.where}` : ""}`,
            kind: "success",
            app: "CallClips",
            onClick: openClipsWindow
        });
        return clip;
    } catch (e: any) {
        logger.error("Saving the clip failed", e);
        notify({ title: "Couldn't save the clip", body: String(e?.message ?? e), kind: "error", app: "CallClips" });
        return null;
    } finally {
        clipState.busy = false;
        emit();
    }
}

// ---------------------------------------------------------------- Actions on saved clips

const mimeOf = (file: string) => file.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/ogg";

export async function readClip(file: string) {
    return new Blob([await Native.readClip(file) as BlobPart], { type: mimeOf(file) });
}

async function clipAsFile(clip: Clip) {
    const blob = await readClip(clip.file);
    return new File([blob], clip.file, { type: blob.type });
}

/** The chat you're looking at – not a voice channel's call view */
export function chatInView(): Channel | null {
    const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId() ?? "");
    if (!channel || channel.isGuildVoice?.() || channel.isGuildStageVoice?.()) return null;
    return channel;
}

/** The voice channel of your call, if it's on a server (it has its own text chat) */
export function callChannel(): Channel | null {
    const channel = ChannelStore.getChannel(SelectedChannelStore.getVoiceChannelId() ?? "");
    return channel?.guild_id ? channel : null;
}

/**
 * Puts the clip into the chat you're looking at, like dropping the file there (you still press Enter).
 * false = no chat open – the caller lets you pick one.
 */
export async function sendToChat(clip: Clip) {
    const channel = chatInView();
    if (!channel) return false;
    UploadHandler.promptToUpload([await clipAsFile(clip)], channel, DraftType.ChannelMessage);
    return true;
}

/** Sends the clip straight into a chat picked in the list (encrypted there if it's a secret chat) */
export async function sendClipTo(clip: Clip, channel: Channel, label: string) {
    await sendFiles(channel, [await clipAsFile(clip)]);
    notify({ title: "Clip sent", body: `${nameOf(clip.file)} → ${label}`, kind: "success", app: "CallClips" });
}

const nameOf = (file: string) => file.replace(/\.(ogg|wav)$/i, "");

export async function renameClip(clip: Clip, name: string) {
    const file = await Native.renameClip(clip.file, name);
    const m = await loadMeta();
    if (file !== clip.file && m[clip.file]) {
        m[file] = m[clip.file];
        delete m[clip.file];
        await saveMeta();
    }
    await refresh();
}

export async function deleteClip(clip: Clip) {
    await Native.deleteClip(clip.file);
    const m = await loadMeta();
    delete m[clip.file];
    await saveMeta();
    await refresh();
}

/** Decoded clip for the trim window */
export async function loadTracks(clip: Clip) {
    return decode(await Native.readClip(clip.file));
}

/** Keeps only start..end (seconds); asCopy saves it as a new clip */
export async function trimClip(clip: Clip, tracks: Float32Array[], start: number, end: number, asCopy: boolean) {
    const a = Math.max(0, Math.floor(start * RATE));
    const b = Math.min(tracks[0].length, Math.ceil(end * RATE));
    if (b - a < RATE / 4) throw new Error("Too short");
    const { data, ext } = await encode(tracks.map(t => t.slice(a, b)));
    const m = await loadMeta();
    const info: ClipMeta = { ...m[clip.file], seconds: (b - a) / RATE };
    if (asCopy) {
        const name = clip.file.replace(/\.(ogg|wav)$/i, "") + " (trimmed)";
        const file = await Native.saveClip(name, ext, data);
        m[file] = { ...info, created: Date.now() };
    } else if (ext === clip.file.slice(-4).toLowerCase()) {
        await Native.overwriteClip(clip.file, data);
        m[clip.file] = info;
    } else {
        // Saved as another type than before (e.g. a WAV clip now as Ogg): new file, old one to the recycle bin
        const file = await Native.saveClip(clip.file.replace(/\.(ogg|wav)$/i, ""), ext, data);
        await Native.deleteClip(clip.file);
        delete m[clip.file];
        m[file] = info;
    }
    await saveMeta();
    await refresh();
}

export const showInFolder = (clip: Clip) => Native.showClip(clip.file);
export const openFolder = () => Native.openFolder();

// ---------------------------------------------------------------- Soundboard
// Discord records the mic natively (outside JavaScript), so a clip can't be fed into it. The soundboard is the way
// to play one in a call: everyone hears it, like any soundboard sound.

/** Discord's limits for soundboard sounds */
export const SOUND_MAX_SECONDS = 5.2;
const SOUND_MAX_BYTES = 512 * 1024;
/** A little under the limit – Opus adds padding Discord may count */
const SOUND_SAFE_SECONDS = 5.1;

/** Error text from a failed RestAPI call (it rejects with the response, not an Error) */
function apiError(e: any) {
    return new Error(e?.body?.message ?? e?.message ?? String(e));
}

/** Servers where you may add soundboard sounds */
export function soundboardGuilds() {
    return Object.values(GuildStore.getGuilds())
        .filter(g => PermissionStore.can(PermissionsBits.CREATE_GUILD_EXPRESSIONS, g) || PermissionStore.can(PermissionsBits.MANAGE_GUILD_EXPRESSIONS, g))
        .sort((a, b) => a.name.localeCompare(b.name));
}

const asDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
});

/** Uploads start..end (seconds, at most 5.2 s) of the clip as a soundboard sound of the server */
export async function addToSoundboard(clip: Clip, tracks: Float32Array[], start: number, end: number, guildId: string, name: string) {
    const a = Math.max(0, Math.floor(start * RATE));
    const b = Math.min(tracks[0].length, Math.ceil(end * RATE), a + Math.floor(SOUND_SAFE_SECONDS * RATE));
    if (b - a < RATE / 4) throw new Error("Too short");
    const { data, ext, type } = await encode(tracks.map(t => t.slice(a, b)));
    if (ext !== ".ogg") throw new Error("Opus encoding isn't available here – the soundboard needs it");
    if (data.length > SOUND_MAX_BYTES) throw new Error("The sound is larger than Discord's 512 KB limit");

    let soundId: string;
    try {
        const res = await RestAPI.post({
            url: `/guilds/${guildId}/soundboard-sounds`,
            body: { name, sound: await asDataUrl(new Blob([data as BlobPart], { type })), volume: 1, emoji_id: null, emoji_name: null }
        });
        soundId = res.body.sound_id;
    } catch (e) {
        throw apiError(e);
    }

    const m = await loadMeta();
    // An older upload of this clip is replaced
    const old = m[clip.file]?.sound;
    if (old) void RestAPI.del({ url: `/guilds/${old.guildId}/soundboard-sounds/${old.soundId}` }).catch(() => { });
    m[clip.file] = { ...m[clip.file], sound: { guildId, soundId } };
    await saveMeta();
    await refresh();
}

async function forgetSound(clip: Clip) {
    const m = await loadMeta();
    if (m[clip.file]) delete m[clip.file].sound;
    await saveMeta();
    await refresh();
}

/** Plays the clip's soundboard sound in your call. Throws if you're not in one or the sound is gone. */
export async function playInCall(clip: Clip) {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (!channelId) throw new Error("Join a voice call first");
    if (!clip.sound) throw new Error("The clip isn't on a soundboard yet");
    try {
        await RestAPI.post({
            url: `/channels/${channelId}/send-soundboard-sound`,
            body: { sound_id: clip.sound.soundId, source_guild_id: clip.sound.guildId }
        });
    } catch (e: any) {
        if (e?.status === 404) {
            await forgetSound(clip);
            throw new Error("The sound was removed from the server's soundboard – add it again");
        }
        throw apiError(e);
    }
}

export async function removeFromSoundboard(clip: Clip) {
    const { sound } = clip;
    if (!sound) return;
    try {
        await RestAPI.del({ url: `/guilds/${sound.guildId}/soundboard-sounds/${sound.soundId}` });
    } catch (e: any) {
        if (e?.status !== 404) throw apiError(e);
    }
    await forgetSound(clip);
}
