/*
 * CallClips – title bar button with the clip list (popout), clips window, trim / rename windows and settings.
 * No JSX at module level (it would run before React is ready and crash Vencord) – only inside components.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import type { Channel } from "@vencord/discord-types";
import { filters, findByPropsLazy, findComponentByCodeLazy, mapMangledModuleLazy } from "@webpack";
import { ChannelActionCreators, ChannelStore, GuildStore, IconUtils, MediaEngineStore, Popout, RelationshipStore, SelectedChannelStore, useEffect, useMemo, useRef, UserStore, useState } from "@webpack/common";
import type { CSSProperties } from "react";

import { AppIcon, Avatar, Button, confirm, Empty, Field, Icon, IconButton, ICONS, LinkRow, Note, notify, openWindow, Popover, Progress, RoundButton, Row, SearchField, Section, Segmented, Select, Sheet, Spinner, strokeIcon, TextField, ToggleRow, useListener } from "../_ui";
import { addToSoundboard, callChannel, Clip, clipListeners, clipState, deleteClip, loadTracks, makeClip, openFolder, playInCall, readClip, refresh, removeFromSoundboard, renameClip, sendClipTo, sendToChat, showInFolder, SOUND_MAX_SECONDS, soundboardGuilds, trimClip } from "./clips";
import { RATE } from "./encode";
import { applyHotkey, settings } from "./index";
import { listeners, MicMode, state } from "./recorder";

const cl = classNameFactory("vc-callclips-");
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');
const POPOUT_STYLE: CSSProperties = { maxHeight: "min(720px, calc(100vh - 72px))" };
/** Discord's own voice panel button (noise suppression, disconnect …), so the clip button looks the same */
const { PanelButton } = mapMangledModuleLazy("Masks.PANEL_BUTTON", { PanelButton: filters.byCode("tooltipPositionKey") });
const VoiceActions = findByPropsLazy("toggleSelfMute", "toggleSelfDeaf");

// Lucide rotate-ccw, send, scissors, pause, keyboard
export const REPLAY_PATH = strokeIcon("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5");
const SEND_PATH = strokeIcon("M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z", "m21.854 2.147-10.94 10.939");
const TRIM_PATH = strokeIcon("M3 6a3 3 0 1 0 6 0a3 3 0 1 0-6 0", "M8.12 8.12 12 12", "M20 4 8.12 15.88", "M3 18a3 3 0 1 0 6 0a3 3 0 1 0-6 0", "M14.8 14.8 20 20");
const PAUSE_PATH = strokeIcon("M15 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", "M7 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z");
const KEY_PATH = strokeIcon("M10 8h.01", "M12 12h.01", "M14 8h.01", "M16 12h.01", "M18 8h.01", "M6 8h.01", "M7 16h10", "M8 12h.01", "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z");

const LENGTHS = [15, 30, 60, 120];

// ---------------------------------------------------------------- Helpers

/** 1:05, or 1:05.3 with tenths */
function formatTime(seconds: number, tenths = false) {
    const t = Math.max(0, tenths ? Math.round(seconds * 10) / 10 : Math.round(seconds));
    const s = Math.floor(t % 60);
    const rest = tenths ? `.${Math.round((t % 1) * 10) % 10}` : "";
    return `${Math.floor(t / 60)}:${String(s).padStart(2, "0")}${rest}`;
}

const formatClock = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

/** Today / Yesterday / Monday, Oct 27 (with the year when it's not this one) */
function formatDay(ms: number) {
    const d = new Date(ms);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const yesterday = new Date(today.getTime() - 86_400_000);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function formatWhen(ms: number) {
    const day = formatDay(ms);
    return day === "Today" || day === "Yesterday" ? `${day} ${formatClock(ms)}` : `${new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${formatClock(ms)}`;
}

const whenOf = (clip: Clip) => clip.created ?? clip.modified;

const nameOf = (file: string) => file.replace(/\.(ogg|wav)$/i, "");

async function guard(what: string, fn: () => Promise<unknown>) {
    try {
        await fn();
    } catch (e: any) {
        notify({ title: `Couldn't ${what}`, body: String(e?.message ?? e), kind: "error", app: "CallClips" });
    }
}

// ---------------------------------------------------------------- Playback (one clip at a time)

const player = { file: null as string | null, playing: false, time: 0, duration: 0 };
const playerListeners = new Set<() => void>();
const emitPlayer = () => playerListeners.forEach(l => l());
let audio: HTMLAudioElement | null = null;
let audioUrl: string | null = null;

function stopPlayback() {
    audio?.pause();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audio = null;
    audioUrl = null;
    Object.assign(player, { file: null, playing: false, time: 0, duration: 0 });
    emitPlayer();
}

async function togglePlay(clip: Clip) {
    if (player.file === clip.file && audio) {
        if (audio.paused) void audio.play();
        else audio.pause();
        return;
    }
    stopPlayback();
    const blob = await readClip(clip.file);
    const a = audio = new Audio(audioUrl = URL.createObjectURL(blob));
    player.file = clip.file;
    player.duration = clip.seconds ?? 0;
    a.ontimeupdate = () => { player.time = a.currentTime; emitPlayer(); };
    a.ondurationchange = () => { if (Number.isFinite(a.duration)) { player.duration = a.duration; emitPlayer(); } };
    a.onplay = () => { player.playing = true; emitPlayer(); };
    a.onpause = () => { player.playing = false; emitPlayer(); };
    a.onended = () => { player.playing = false; player.time = 0; emitPlayer(); };
    emitPlayer();
    await a.play();
}

// ---------------------------------------------------------------- Deafen while editing

/** Set when the trim / soundboard window deafened you – only then it undeafens again */
let deafenedByUs = false;

/** Back to how it was before the window opened (a manual undeafen meanwhile is left alone) */
function undeafen() {
    if (!deafenedByUs) return;
    deafenedByUs = false;
    if (MediaEngineStore.isSelfDeaf()) VoiceActions.toggleSelfDeaf();
}

/** In a call the others would talk over the clip – deafen while the window is open */
function useDeafenWhileOpen() {
    useEffect(() => {
        if (!settings.store.deafenWhileEditing || deafenedByUs || !SelectedChannelStore.getVoiceChannelId() || MediaEngineStore.isSelfDeaf()) return;
        VoiceActions.toggleSelfDeaf();
        deafenedByUs = true;
        return undeafen;
    }, []);
}

// ---------------------------------------------------------------- Windows

function RenameSheet({ clip, onClose }: { clip: Clip; onClose(): void; }) {
    const [name, setName] = useState(nameOf(clip.file));
    const save = () => guard("rename the clip", async () => {
        await renameClip(clip, name);
        onClose();
    });
    return (
        <Sheet
            header={{ title: "Rename clip", icon: ICONS.edit, iconColor: "gray" }}
            onClose={onClose}
            actions={[{ label: "Cancel", onClick: onClose }, { label: "Save", onClick: save, disabled: !name.trim() }]}
        >
            <Section plain>
                <Field label="Name">
                    <TextField value={name} autoFocus onChange={setName} onKeyDown={e => e.key === "Enter" && name.trim() && save()} />
                </Field>
            </Section>
        </Sheet>
    );
}

const openRename = (clip: Clip) => openWindow(close => <RenameSheet clip={clip} onClose={close} />, { size: "small" });

/** Loudest sample per bar, 0..1 (left + right) */
function peaksOf(tracks: Float32Array[], bars: number) {
    const frames = tracks[0].length;
    const size = Math.max(1, Math.floor(frames / bars));
    const out = new Float32Array(bars);
    let max = 0;
    for (let b = 0; b < bars; b++) {
        let peak = 0;
        const from = b * size, to = Math.min(frames, from + size);
        for (const t of tracks) for (let i = from; i < to; i += 4) peak = Math.max(peak, Math.abs(t[i]));
        out[b] = peak;
        max = Math.max(max, peak);
    }
    // Quiet clips still fill the height
    if (max > 0) for (let b = 0; b < bars; b++) out[b] /= max;
    return out;
}

const BARS = 140;
const MIN_LENGTH = 0.25;

type Drag = "start" | "end" | "seek";

/**
 * Waveform with the kept part between two handles. Outside is dimmed, the line shows where it plays.
 * Click = jump there, drag a handle = new start / end, space = play / pause.
 */
function Trimmer({ tracks, audio, range, onRange, time, onSeek }: {
    tracks: Float32Array[]; audio: HTMLAudioElement | null;
    range: [number, number]; onRange(r: [number, number]): void;
    time: number; onSeek(t: number): void;
}) {
    const total = tracks[0].length / RATE;
    const peaks = useMemo(() => peaksOf(tracks, BARS), [tracks]);
    const box = useRef<HTMLDivElement>(null);
    const drag = useRef<Drag | null>(null);
    const [start, end] = range;
    const pct = (t: number) => `${t / total * 100}%`;

    const timeAt = (clientX: number) => {
        const r = box.current!.getBoundingClientRect();
        return Math.min(total, Math.max(0, (clientX - r.left) / r.width * total));
    };

    const move = (clientX: number) => {
        const t = timeAt(clientX);
        if (drag.current === "start") onRange([Math.min(t, end - MIN_LENGTH), end]);
        else if (drag.current === "end") onRange([start, Math.max(t, start + MIN_LENGTH)]);
        else if (drag.current === "seek") onSeek(t);
    };

    const down = (e: React.PointerEvent, what: Drag) => {
        e.preventDefault();
        e.stopPropagation();
        drag.current = what;
        box.current!.setPointerCapture(e.pointerId);
        move(e.clientX);
    };

    return (
        <div className={cl("trimmer")}>
            <div
                ref={box}
                className={cl("wave")}
                onPointerDown={e => down(e, "seek")}
                onPointerMove={e => drag.current && move(e.clientX)}
                onPointerUp={() => drag.current = null}
                onPointerCancel={() => drag.current = null}
            >
                <div className={cl("bars")}>
                    {Array.from(peaks, (p, i) => {
                        const at = (i + 0.5) / BARS * total;
                        return <i key={i} className={classes(at >= start && at <= end ? cl("bar-in") : cl("bar-out"), audio && at <= time && at >= start && at <= end && cl("bar-played"))} style={{ height: `${Math.max(4, p * 100)}%` }} />;
                    })}
                </div>
                <div className={classes(cl("shade"), cl("shade-left"))} style={{ left: 0, width: pct(start) }} />
                <div className={classes(cl("shade"), cl("shade-right"))} style={{ left: pct(end), right: 0 }} />
                <div className={cl("sel")} style={{ left: pct(start), width: pct(end - start) }} />
                <div className={cl("handle")} style={{ left: pct(start) }} onPointerDown={e => down(e, "start")}><span /></div>
                <div className={cl("handle")} style={{ left: pct(end) }} onPointerDown={e => down(e, "end")}><span /></div>
                <div className={cl("playhead")} style={{ left: pct(time) }} />
            </div>
            <div className={cl("ruler")}>
                <span>0:00</span>
                <span className={cl("ruler-mid")}>
                    <b>{formatTime(start, true)}</b> – <b>{formatTime(end, true)}</b> · {(end - start).toFixed(1)} s
                </span>
                <span>{formatTime(total)}</span>
            </div>
        </div>
    );
}

/**
 * Waveform editor. Trims the clip – or, with `sound`, picks the part (at most 5.2 s) that goes onto a server's
 * soundboard so it can be played in calls.
 */
function TrimSheet({ clip, sound, onClose }: { clip: Clip; sound?: boolean; onClose(): void; }) {
    const [tracks, setTracks] = useState<Float32Array[] | null>(null);
    const [error, setError] = useState("");
    const [range, setRange] = useState<[number, number]>([0, 0]);
    const [time, setTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [saving, setSaving] = useState(false);
    const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
    const rangeRef = useRef(range);
    rangeRef.current = range;
    useDeafenWhileOpen();

    useEffect(() => {
        let url: string | null = null;
        let a: HTMLAudioElement | null = null;
        let frame = 0;
        // Smooth playhead while playing; stops at the end handle
        const tick = () => {
            if (!a) return;
            const [, end] = rangeRef.current;
            if (a.currentTime >= end) {
                a.pause();
                a.currentTime = end;
            }
            setTime(a.currentTime);
            if (!a.paused) frame = requestAnimationFrame(tick);
        };
        loadTracks(clip).then(t => {
            setTracks(t);
            const length = t[0].length / RATE;
            // For the soundboard: the last 5.2 s – the moment you clipped is at the end
            setRange(sound ? [Math.max(0, length - SOUND_MAX_SECONDS), length] : [0, length]);
            return readClip(clip.file);
        }).then(blob => {
            a = new Audio(url = URL.createObjectURL(blob));
            a.onplay = () => { setPlaying(true); frame = requestAnimationFrame(tick); };
            a.onpause = () => { setPlaying(false); cancelAnimationFrame(frame); setTime(a!.currentTime); };
            setAudio(a);
        }).catch(e => setError(String(e?.message ?? e)));
        return () => {
            cancelAnimationFrame(frame);
            a?.pause();
            if (url) URL.revokeObjectURL(url);
        };
    }, [clip.file]);

    const [start, end] = range;

    const seek = (t: number) => {
        setTime(t);
        if (audio) audio.currentTime = t;
    };

    const toggle = () => {
        if (!audio) return;
        if (!audio.paused) return audio.pause();
        // From the playhead if it's inside the kept part, else from its start
        if (audio.currentTime < start || audio.currentTime >= end - 0.05) audio.currentTime = start;
        void audio.play();
    };

    const changeRange = (r: [number, number]) => {
        // Soundboard: the other handle follows, so the part never gets longer than Discord allows
        if (sound && r[1] - r[0] > SOUND_MAX_SECONDS) {
            r = r[0] !== start ? [r[0], r[0] + SOUND_MAX_SECONDS] : [r[1] - SOUND_MAX_SECONDS, r[1]];
        }
        setRange(r);
        // Keep the playhead inside while moving the handles
        if (audio && (audio.currentTime < r[0] || audio.currentTime > r[1])) seek(Math.min(Math.max(audio.currentTime, r[0]), r[1]));
    };

    // Space = play / pause (not while typing somewhere)
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if (e.code !== "Space" || (e.target as HTMLElement)?.closest?.("input, textarea")) return;
            e.preventDefault();
            toggle();
        };
        window.addEventListener("keydown", key, true);
        return () => window.removeEventListener("keydown", key, true);
    });

    const save = (asCopy: boolean) => guard("trim the clip", async () => {
        if (!tracks) return;
        setSaving(true);
        try {
            audio?.pause();
            await trimClip(clip, tracks, start, end, asCopy);
            onClose();
            notify({
                title: asCopy ? "Trimmed copy saved" : "Clip trimmed",
                body: asCopy ? `${(end - start).toFixed(1)} s, the original stays as it was` : `Now ${(end - start).toFixed(1)} s – the untrimmed one is in the recycle bin`,
                kind: "success",
                app: "CallClips"
            });
        } finally {
            setSaving(false);
        }
    });

    const total = tracks ? tracks[0].length / RATE : 0;
    const unchanged = start === 0 && end === total;

    if (sound) return (
        <SoundSheet clip={clip} tracks={tracks} error={error} range={range} onClose={onClose} beforeSave={() => audio?.pause()}>
            {tracks && (
                <Section plain>
                    <Trimmer tracks={tracks} audio={audio} range={range} onRange={changeRange} time={time} onSeek={seek} />
                    <div className={cl("trim-foot")}>
                        <button type="button" className={cl("trim-play")} aria-label={playing ? "Pause" : "Play"} disabled={!audio} onClick={toggle}>
                            <Icon path={playing ? PAUSE_PATH : ICONS.play} size={18} />
                        </button>
                        <span className={cl("trim-time")}>{formatTime(time, true)}</span>
                        <span className={cl("dim")}>Pick up to {SOUND_MAX_SECONDS} s · space to play</span>
                    </div>
                </Section>
            )}
        </SoundSheet>
    );

    return (
        <Sheet
            header={{ title: "Trim clip", subtitle: nameOf(clip.file), icon: TRIM_PATH, iconColor: "gray" }}
            onClose={onClose}
            actions={[
                { label: "Cancel", onClick: onClose },
                { label: "Save as copy", onClick: () => save(true), disabled: !tracks || saving || unchanged, variant: "gray" },
                { label: saving ? "Saving…" : "Save", onClick: () => save(false), disabled: !tracks || saving || unchanged }
            ]}
        >
            {error ? <Note tone="bad">{error}</Note> : !tracks ? (
                <div className={cl("loading")}><Spinner /> Loading clip…</div>
            ) : (
                <Section plain>
                    <Trimmer tracks={tracks} audio={audio} range={range} onRange={changeRange} time={time} onSeek={seek} />
                    <div className={cl("trim-foot")}>
                        <button type="button" className={cl("trim-play")} aria-label={playing ? "Pause" : "Play"} disabled={!audio} onClick={toggle}>
                            <Icon path={playing ? PAUSE_PATH : ICONS.play} size={18} />
                        </button>
                        <span className={cl("trim-time")}>{formatTime(time, true)}</span>
                        <span className={cl("dim")}>Drag the handles · click to jump · space to play</span>
                        <Button small variant="plain" disabled={unchanged} onClick={() => changeRange([0, total])}>Reset</Button>
                    </div>
                </Section>
            )}
        </Sheet>
    );
}

const openTrim = (clip: Clip, sound?: boolean) => {
    stopPlayback();
    openWindow(close => <TrimSheet clip={clip} sound={sound} onClose={close} />, { size: "medium", className: cl("fit-window") });
};

// ---------------------------------------------------------------- Soundboard

// Lucide audio-lines
const SOUNDBOARD_PATH = strokeIcon("M2 10v3", "M6 6v11", "M10 3v18", "M14 8v7", "M18 5v13", "M22 10v3");

const guildName = (id: string) => GuildStore.getGuild(id)?.name ?? "a server";
/** Soundboard names: 2–32 characters */
const soundName = (file: string) => nameOf(file).slice(0, 32).padEnd(2, "_");

function SoundSheet({ clip, tracks, error, range, beforeSave, onClose, children }: {
    clip: Clip; tracks: Float32Array[] | null; error: string; range: [number, number];
    beforeSave(): void; onClose(): void; children: React.ReactNode;
}) {
    useListener(clipListeners);
    // The list re-reads its clips after an upload – show the current state of this one
    const current = clipState.clips.find(c => c.file === clip.file) ?? clip;
    const guilds = useMemo(soundboardGuilds, []);
    const callGuild = callChannel()?.guild_id;
    const [guildId, setGuildId] = useState(() => guilds.find(g => g.id === callGuild)?.id ?? guilds[0]?.id ?? "");
    const [name, setName] = useState(() => soundName(clip.file));
    const [busy, setBusy] = useState(false);
    const inCall = !!SelectedChannelStore.getVoiceChannelId();

    const add = (play: boolean) => guard("add the clip to the soundboard", async () => {
        if (!tracks || !guildId) return;
        setBusy(true);
        try {
            beforeSave();
            await addToSoundboard(current, tracks, range[0], range[1], guildId, name.trim());
            if (play) {
                // Discord doesn't play soundboard sounds while you're deafened
                undeafen();
                const fresh = clipState.clips.find(c => c.file === clip.file);
                if (fresh) await playInCall(fresh);
            }
            onClose();
            notify({ title: play ? "Played in the call" : "Added to the soundboard", body: `“${name.trim()}” · ${guildName(guildId)}`, kind: "success", app: "CallClips" });
        } finally {
            setBusy(false);
        }
    });

    const remove = () => guard("remove the sound", async () => {
        setBusy(true);
        try {
            await removeFromSoundboard(current);
        } finally {
            setBusy(false);
        }
    });

    const validName = name.trim().length >= 2 && name.trim().length <= 32;
    const ready = !!tracks && !!guildId && validName && !busy;

    return (
        <Sheet
            header={{ title: "Play in calls", subtitle: nameOf(clip.file), icon: SOUNDBOARD_PATH, iconColor: "gray" }}
            onClose={onClose}
            actions={[
                { label: "Cancel", onClick: onClose },
                ...inCall ? [{ label: "Add & play", onClick: () => add(true), disabled: !ready, variant: "gray" as const }] : [],
                { label: busy ? "Uploading…" : current.sound ? "Replace" : "Add to soundboard", onClick: () => add(false), disabled: !ready }
            ]}
        >
            {current.sound && (
                <Section>
                    <Row
                        leading={<AppIcon path={SOUNDBOARD_PATH} color="gray" size={28} />}
                        title={`On the soundboard of ${guildName(current.sound.guildId)}`}
                        subtitle="The soundboard button in the list plays it in your call"
                        trailing={<Button small variant="destructive" icon={ICONS.trash} disabled={busy} onClick={remove}>Remove</Button>}
                    />
                </Section>
            )}
            {error ? <Note tone="bad">{error}</Note> : !tracks ? (
                <div className={cl("loading")}><Spinner /> Loading clip…</div>
            ) : children}
            {!guilds.length ? (
                <Note tone="warn">You can't add soundboard sounds on any of your servers. It needs the “Create Expressions” permission – on your own server you have it.</Note>
            ) : (
                <Section plain>
                    <Field label="Server" hint="Its soundboard needs a free slot. Playing it in calls of other servers or DMs needs Nitro.">
                        <Select<string> value={guildId} options={guilds.map(g => ({ value: g.id, label: g.name }))} onChange={setGuildId} />
                    </Field>
                    <Field label="Name" hint={validName ? "Everyone in the call sees who played it and this name." : "2–32 characters"}>
                        <TextField value={name} onChange={setName} />
                    </Field>
                </Section>
            )}
        </Sheet>
    );
}

/** On a soundboard and in a call: play it. Otherwise (or right-click): the soundboard window. */
async function soundClip(clip: Clip) {
    if (clip.sound && SelectedChannelStore.getVoiceChannelId()) {
        await playInCall(clip);
        return;
    }
    openTrim(clip, true);
}

// ---------------------------------------------------------------- Send to a chat (when none is open)

interface Target {
    key: string;
    label: string;
    sub: string;
    avatar?: string;
    icon?: string;
    /** Existing chat, or a friend without a DM yet */
    channel?: Channel;
    userId?: string;
}

const userName = (u: any) => u?.globalName || u?.username || "Unknown";
const avatarOf = (u: any) => { try { return u ? IconUtils.getUserAvatarURL(u, false, 64) : undefined; } catch { return undefined; } };
// Lucide users, volume-2
const GROUP_PATH = strokeIcon("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75");
const SPEAKER_PATH = strokeIcon("M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z", "M16 9a5 5 0 0 1 0 6", "M19.364 18.364a9 9 0 0 0 0-12.728");

function chatTarget(c: Channel): Target {
    const users = (c.recipients ?? []).map(id => UserStore.getUser(id)).filter(Boolean);
    if (c.isDM?.() || (c.type === 1)) {
        const u = users[0];
        return { key: c.id, label: userName(u), sub: u?.username ? `@${u.username}` : "Direct message", avatar: avatarOf(u), channel: c };
    }
    const label = c.name || users.map(userName).join(", ") || "Group";
    let avatar: string | undefined;
    try { avatar = c.icon ? IconUtils.getChannelIconURL({ id: c.id, icon: c.icon, size: 64 }) : undefined; } catch { }
    return { key: c.id, label, sub: `Group · ${users.length + 1} members`, avatar, icon: GROUP_PATH, channel: c };
}

function targetsFor(query: string): Target[] {
    const q = query.trim().toLowerCase();
    const out: Target[] = [];
    const call = callChannel();
    if (call && (!q || call.name.toLowerCase().includes(q))) {
        const guild = GuildStore.getGuild(call.guild_id);
        out.push({ key: call.id, label: call.name, sub: `Chat of your call${guild ? ` · ${guild.name}` : ""}`, icon: SPEAKER_PATH, channel: call });
    }

    const chats = ChannelStore.getSortedPrivateChannels().map(chatTarget);
    const matches = (t: Target) => !q || t.label.toLowerCase().includes(q) || t.sub.toLowerCase().includes(q);
    out.push(...chats.filter(matches).slice(0, q ? 30 : 25));

    // Searching also finds friends you have no DM with yet
    if (q) {
        const withDm = new Set(chats.flatMap(t => t.channel?.isDM?.() ? t.channel.recipients ?? [] : []));
        for (const id of RelationshipStore.getFriendIDs()) {
            if (withDm.has(id)) continue;
            const u = UserStore.getUser(id);
            const t: Target = { key: `friend:${id}`, label: userName(u), sub: u?.username ? `@${u.username} · Friend` : "Friend", avatar: avatarOf(u), userId: id };
            if (matches(t)) out.push(t);
            if (out.length > 40) break;
        }
    }
    return out;
}

function SendSheet({ clip, onClose }: { clip: Clip; onClose(): void; }) {
    const [query, setQuery] = useState("");
    const [sending, setSending] = useState<string | null>(null);
    const targets = useMemo(() => targetsFor(query), [query]);

    const send = (t: Target) => guard("send the clip", async () => {
        setSending(t.key);
        try {
            let { channel } = t;
            if (!channel && t.userId) {
                const id: string = await (ChannelActionCreators as any).ensurePrivateChannel([t.userId]);
                channel = ChannelStore.getChannel(id);
            }
            if (!channel) throw new Error("The chat could not be opened");
            await sendClipTo(clip, channel, t.label);
            onClose();
        } finally {
            setSending(null);
        }
    });

    return (
        <Sheet
            header={{ title: "Send clip", subtitle: nameOf(clip.file), icon: SEND_PATH, iconColor: "gray" }}
            onClose={onClose}
            top={
                <div className={cl("search")}>
                    <SearchField value={query} onChange={setQuery} placeholder="Search chats and friends" autoFocus />
                </div>
            }
        >
            {!targets.length ? (
                <Empty icon={ICONS.search} title="Nothing found" hint="Search for a DM, a group or a friend." />
            ) : (
                <Section title={query ? "Results" : "Recent chats"}>
                    {targets.map(t => (
                        <Row
                            key={t.key}
                            leading={t.avatar ? <Avatar src={t.avatar} size={32} /> : <AppIcon path={t.icon ?? ICONS.user} color="gray" size={32} />}
                            title={t.label}
                            subtitle={t.sub}
                            onClick={sending ? undefined : () => send(t)}
                            trailing={sending === t.key ? <Spinner /> : <Icon path={SEND_PATH} size={16} />}
                        />
                    ))}
                </Section>
            )}
        </Sheet>
    );
}

const openSendPicker = (clip: Clip) => openWindow(close => <SendSheet clip={clip} onClose={close} />, { size: "small" });

/** Into the open chat's text box, or – when none is open (e.g. watching the call) – pick a chat */
async function sendClip(clip: Clip, done?: () => void) {
    if (await sendToChat(clip)) done?.();
    else openSendPicker(clip);
}

// ---------------------------------------------------------------- Clip list

function ClipRow({ clip, onSent, timeOnly }: { clip: Clip; onSent?(): void; timeOnly?: boolean; }) {
    useListener(playerListeners);
    const current = player.file === clip.file;
    const length = current && player.duration ? player.duration : clip.seconds;

    const remove = () => guard("delete the clip", async () => {
        if (!await confirm({ title: `Delete “${nameOf(clip.file)}”?`, body: "It goes to the recycle bin.", confirmText: "Delete", destructive: true })) return;
        if (current) stopPlayback();
        await deleteClip(clip);
    });

    return (
        <Row
            leading={<RoundButton icon={current && player.playing ? PAUSE_PATH : ICONS.play} label={current && player.playing ? "Pause" : "Play"} active={current} onClick={() => guard("play the clip", () => togglePlay(clip))} />}
            title={nameOf(clip.file)}
            subtitle={[
                current && player.time > 0 ? `${formatTime(player.time)} / ${formatTime(length ?? 0)}` : length != null && formatTime(length),
                clip.where,
                timeOnly ? formatClock(whenOf(clip)) : formatWhen(whenOf(clip))
            ].filter(Boolean).join(" · ")}
            trailing={
                <div className={cl("actions")}>
                    <span className={cl("sound-btn")} onContextMenu={e => { e.preventDefault(); openTrim(clip, true); }}>
                        <IconButton
                            icon={SOUNDBOARD_PATH}
                            label={clip.sound ? "Play in your call (right-click: soundboard)" : "Play in calls via the soundboard"}
                            onClick={() => guard("play the clip in the call", () => soundClip(clip))}
                        />
                    </span>
                    <IconButton icon={SEND_PATH} label="Send into a chat" onClick={() => guard("send the clip", () => sendClip(clip, onSent))} />
                    <IconButton icon={TRIM_PATH} label="Trim" onClick={() => openTrim(clip)} />
                    <IconButton icon={ICONS.edit} label="Rename" onClick={() => openRename(clip)} />
                    <IconButton icon={ICONS.folder} label="Show in folder" onClick={() => showInFolder(clip)} />
                    <IconButton icon={ICONS.trash} label="Delete" destructive onClick={remove} />
                </div>
            }
        >
            {current && length ? <Progress value={player.time / length * 100} /> : null}
        </Row>
    );
}

/** "Recent" shows what you clipped in the last 2 hours */
const RECENT_MS = 2 * 60 * 60 * 1000;
type Tab = "recent" | "all";

/** Every clip, searchable, grouped by day */
function AllClips({ clips, onSent }: { clips: Clip[]; onSent?(): void; }) {
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();
    const found = q ? clips.filter(c => nameOf(c.file).toLowerCase().includes(q) || c.where?.toLowerCase().includes(q)) : clips;

    const days: { day: string; clips: Clip[]; }[] = [];
    for (const c of found) {
        const day = formatDay(whenOf(c));
        if (days.at(-1)?.day === day) days.at(-1)!.clips.push(c);
        else days.push({ day, clips: [c] });
    }

    return (
        <>
            <div className={cl("search")}>
                <SearchField value={query} onChange={setQuery} placeholder="Search by name, channel or server" />
            </div>
            {!days.length ? (
                <Empty icon={ICONS.search} title="Nothing found" hint="No clip has that in its name or where it was made." />
            ) : days.map(d => (
                <Section key={d.day} title={`${d.day} · ${d.clips.length}`}>
                    {d.clips.map(c => <ClipRow key={c.file} clip={c} onSent={onSent} timeOnly />)}
                </Section>
            ))}
        </>
    );
}

function ClipsSheet({ embedded, onClose }: { embedded?: boolean; onClose(): void; }) {
    useListener(listeners);
    useListener(clipListeners);
    const { seconds, hotkey } = settings.use(["seconds", "hotkey"]);
    const [tab, setTab] = useState<Tab>("recent");

    useEffect(() => {
        void refresh();
        return stopPlayback;
    }, []);

    const subtitle = state.running ? `Recording · last ${seconds} s` : "Join a voice call to clip";
    const clips = [...clipState.clips].sort((a, b) => whenOf(b) - whenOf(a));
    const recent = clips.filter(c => Date.now() - whenOf(c) < RECENT_MS);
    const onSent = embedded ? undefined : onClose;

    return (
        // Not the kit's embedded mode in the popout – that one has no scroll area of its own
        <Sheet
            onClose={embedded ? undefined : onClose}
            header={{
                app: "CallClips",
                title: "CallClips",
                subtitle,
                live: state.running,
                icon: REPLAY_PATH,
                iconColor: "red",
                actions: <RoundButton icon={ICONS.folder} label="Open clips folder" onClick={() => void openFolder()} />
            }}
            top={
                <div className={cl("top")}>
                    <Button wide icon={REPLAY_PATH} disabled={!state.running || clipState.busy} onClick={() => void makeClip()}>
                        {clipState.busy ? "Saving…" : `Clip last ${seconds} s`}
                    </Button>
                    <span className={cl("dim")}>{hotkey ? `or press ${hotkey} – also in games` : "Set a shortcut in the plugin settings"}</span>
                    {state.error && !state.running && <Note tone="bad">Recording failed: {state.error}</Note>}
                    {clips.length > 0 && (
                        <div className={cl("tabs")}>
                            <Segmented<Tab>
                                value={tab}
                                options={[{ value: "recent", label: "Recent", count: recent.length }, { value: "all", label: "All clips", count: clips.length }]}
                                onChange={setTab}
                            />
                        </div>
                    )}
                </div>
            }
        >
            {!clipState.loaded ? (
                <div className={cl("loading")}><Spinner /> Loading clips…</div>
            ) : !clips.length ? (
                <Empty icon={REPLAY_PATH} title="No clips yet" hint="While you're in a call, the last seconds are kept. Clip them with the button or your shortcut." />
            ) : tab === "all" ? (
                <AllClips clips={clips} onSent={onSent} />
            ) : !recent.length ? (
                <Empty icon={REPLAY_PATH} title="Nothing clipped in the last 2 hours" hint="Your older clips are under All clips.">
                    <Button small variant="gray" onClick={() => setTab("all")}>Show all clips</Button>
                </Empty>
            ) : (
                <Section title="Last 2 hours">
                    {recent.map(c => <ClipRow key={c.file} clip={c} onSent={onSent} timeOnly />)}
                </Section>
            )}
        </Sheet>
    );
}

export function openClipsWindow() {
    openWindow(close => <ClipsSheet onClose={close} />, { size: "medium" });
}

// ---------------------------------------------------------------- Title bar

function TitleBarButton() {
    const { showTitleBarButton } = settings.use(["showTitleBarButton"]);
    useListener(listeners);
    const buttonRef = useRef(null);
    const [show, setShow] = useState(false);
    if (!showTitleBarButton) return null;

    return (
        <Popout
            position="bottom"
            align="left"
            animation={Popout.Animation.NONE}
            shouldShow={show}
            onRequestClose={() => setShow(false)}
            targetElementRef={buttonRef}
            renderPopout={() => (
                <ErrorBoundary noop>
                    <Popover width={460} style={POPOUT_STYLE}>
                        <ClipsSheet embedded onClose={() => setShow(false)} />
                    </Popover>
                </ErrorBoundary>
            )}
        >
            {(_: any, { isShown }: { isShown: boolean; }) => (
                <HeaderBarIcon
                    ref={buttonRef}
                    className={classes(cl("titlebtn"), state.running && cl("titlebtn-live"))}
                    onClick={() => setShow(v => !v)}
                    tooltip={isShown ? null : state.running ? `CallClips – recording, clip the last ${settings.store.seconds} s` : "CallClips"}
                    icon={() => (
                        <span className={cl("tb-icon")}>
                            <Icon path={REPLAY_PATH} size={20} className="vc-ui-tb-icon" />
                            {state.running && <i className={cl("rec-dot")} />}
                        </span>
                    )}
                />
            )}
        </Popout>
    );
}

export function renderTitleBarButton() {
    return (
        <ErrorBoundary key="vc-callclips-titlebar" noop>
            <TitleBarButton />
        </ErrorBoundary>
    );
}

// ---------------------------------------------------------------- Voice panel button

const CHECK_PATH = ICONS.check;

/** Left click = clip now, right click = clip list. Shows a check for a moment after clipping. */
function PanelClipButton() {
    useListener(listeners);
    useListener(clipListeners);
    const { seconds, hotkey, showPanelButton } = settings.use(["seconds", "hotkey", "showPanelButton"]);
    const [done, setDone] = useState(false);
    if (!showPanelButton) return null;

    const ready = state.running && !clipState.busy;
    const clip = async () => {
        if (await makeClip()) {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
        }
    };

    const tooltip = clipState.busy ? "Saving clip…"
        : !state.running ? (state.error ? `Clipping unavailable: ${state.error}` : "Getting ready to clip…")
            : `Clip last ${seconds} s${hotkey ? ` (${hotkey})` : ""} · right-click: all clips`;

    return (
        <PanelButton
            tooltipText={tooltip}
            disabled={!ready && !done}
            onClick={() => void clip()}
            onContextMenu={(e: React.MouseEvent) => { e.preventDefault(); openClipsWindow(); }}
            icon={({ width = 20 }: { width?: number; height?: number; }) => (
                <Icon path={done ? CHECK_PATH : REPLAY_PATH} size={width} className={done ? cl("panel-done") : undefined} />
            )}
        />
    );
}

export function renderPanelButton() {
    return (
        <ErrorBoundary key="vc-callclips-panel" noop>
            <PanelClipButton />
        </ErrorBoundary>
    );
}

// ---------------------------------------------------------------- Settings

const KEY_NAMES: Record<string, string> = {
    Space: "Space", Enter: "Enter", Tab: "Tab", Insert: "Insert", Delete: "Delete", Home: "Home", End: "End",
    PageUp: "PageUp", PageDown: "PageDown", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Backquote: "`", BracketLeft: "[", BracketRight: "]",
    Semicolon: ";", Quote: "'", Backslash: "\\"
};

/** Electron accelerator from a key press, null while only modifiers are held */
function acceleratorOf(e: React.KeyboardEvent): string | null {
    const { code } = e;
    let key: string | undefined;
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    else if (/^Digit\d$/.test(code)) key = code.slice(5);
    else if (/^Numpad\d$/.test(code)) key = `num${code.slice(6)}`;
    else if (/^F\d{1,2}$/.test(code)) key = code;
    else key = KEY_NAMES[code];
    if (!key) return null;
    const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
    // A plain letter would block typing everywhere – only F-keys may go without a modifier
    if (!mods.length && !/^F\d/.test(key)) return null;
    return [...mods, key].join("+");
}

function HotkeyRow() {
    const { hotkey } = settings.use(["hotkey"]);
    const [listening, setListening] = useState(false);
    const [problem, setProblem] = useState("");

    const set = async (acc: string) => {
        setListening(false);
        if (await applyHotkey(acc)) {
            settings.store.hotkey = acc;
            setProblem("");
        } else {
            setProblem(`${acc} is taken by another app`);
            void applyHotkey(hotkey);
        }
    };

    return (
        <Row
            leading={<AppIcon path={KEY_PATH} color="gray" size={28} />}
            title="Shortcut"
            subtitle={problem || (listening ? "Press the keys … (Esc cancels, Backspace removes)" : "Works everywhere, also while a game is open")}
            trailing={
                <button
                    type="button"
                    className={classes(cl("hotkey"), listening && cl("hotkey-listening"), problem && cl("hotkey-bad"))}
                    onClick={() => setListening(true)}
                    onBlur={() => setListening(false)}
                    onKeyDown={e => {
                        if (!listening) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.key === "Escape") return setListening(false);
                        if (e.key === "Backspace") return void set("");
                        const acc = acceleratorOf(e);
                        if (acc) void set(acc);
                    }}
                >
                    {listening ? "Press keys…" : hotkey || "None"}
                </button>
            }
        />
    );
}

export const SettingsPanel = ErrorBoundary.wrap(() => {
    const s = settings.use(["seconds", "micMode", "showTitleBarButton", "showPanelButton", "deafenWhileEditing"]);
    return (
        <Sheet embedded header={{ app: "CallClips", title: "CallClips", subtitle: "Clip the last seconds of a voice call", icon: REPLAY_PATH, iconColor: "gray" }}>
            <Section title="Clip length" footer="Kept in memory only while you're in a call – nothing is saved until you clip.">
                <div className={cl("seg")}>
                    <Segmented
                        value={String(s.seconds)}
                        options={LENGTHS.map(n => ({ value: String(n), label: n < 60 ? `${n} s` : `${n / 60} min` }))}
                        onChange={v => settings.store.seconds = Number(v)}
                    />
                </div>
            </Section>
            <Section title="Your microphone" footer="Clips have the PC's sound – the others in the call, but also music or a game that plays. “While Discord sends it” follows mute and push-to-talk.">
                <div className={cl("seg")}>
                    <Segmented<MicMode>
                        value={s.micMode as MicMode}
                        options={[{ value: "auto", label: "While Discord sends it" }, { value: "always", label: "Always" }, { value: "never", label: "Never" }]}
                        onChange={v => settings.store.micMode = v}
                    />
                </div>
            </Section>
            <Section title="Controls">
                <HotkeyRow />
                <ToggleRow icon={REPLAY_PATH} title="Clip button in the voice panel" subtitle="Bottom left while you're in a call – right-click it for all clips" checked={s.showPanelButton} onChange={v => settings.store.showPanelButton = v} />
                <ToggleRow icon={TRIM_PATH} title="Deafen while trimming" subtitle="In a call, the trim and soundboard windows deafen you so you hear only the clip – undeafened when you close them" checked={s.deafenWhileEditing} onChange={v => settings.store.deafenWhileEditing = v} />
                <ToggleRow icon={REPLAY_PATH} title="Show icon in the title bar" checked={s.showTitleBarButton} onChange={v => settings.store.showTitleBarButton = v} />
                <LinkRow icon={ICONS.folder} onClick={() => void openFolder()}>Open clips folder</LinkRow>
                <LinkRow icon={REPLAY_PATH} onClick={openClipsWindow}>Show clips</LinkRow>
            </Section>
        </Sheet>
    );
}, { noop: true });
