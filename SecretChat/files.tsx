/*
 * SecretChat – Encrypted files.
 * Sending: the file is encrypted with the chat key (AES-GCM) and uploaded as "<random>.bin"; name, type, size and
 * the IV travel in the (encrypted) message text as "SCF1:{…}". Discord and people without the key only see random
 * characters and a .bin file.
 * Receiving: the interceptor takes the .bin out of the message and remembers it; the accessory below the message
 * downloads it (page fetch, or the main process if CORS blocks it), decrypts it and shows the image / video / audio,
 * or a card with a download button.
 * Over the upload limit: the encrypted .bin goes to Catbox (direct link, loads like an attachment) or Gofile (only a
 * download page – the user downloads the .bin there and picks it with "Decrypt .bin"); the link is in the manifest.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { classNameFactory } from "@api/Styles";
import { Logger } from "@utils/Logger";
import { openModal } from "@utils/modal";
import { PluginNative } from "@utils/types";
import { Channel, Message } from "@vencord/discord-types";
import { Constants, MessageActions, PendingReplyStore, RestAPI, SnowflakeUtils, Tooltip, useEffect, UserStore, useState } from "@webpack/common";

import { Button, Icon, ICONS, notify } from "../_ui";
import { attachmentOf, formatBytes, sendFiles as sendPlainFiles, uploadLimit, uploadOne } from "../ChatPopout/upload";
import { uploadForLink } from "../GofileUpload";
import { decryptFile, encryptFile, encryptMessage, randomBytes, toHex } from "./crypto";
import { openFileInfo } from "./fileinfo";
import { LOCK_ICON } from "./icons";
import { VideoPlayer } from "./player";
import { createFileProgress, saveDecrypted } from "./save";
import { settings } from "./settings";
import { channelKey, getKeyBytes, isLoaded } from "./store";
import { LockIcon } from "./ui";
import { VoicePlayer } from "./voiceplayer";

const logger = new Logger("SecretChat");
const cl = classNameFactory("vc-secretchat-");

const Native = VencordNative.pluginHelpers["Unter das OS"] as PluginNative<typeof import("./native")>;

/** Start of the decrypted text of a file message */
export const FILE_MARK = "SCF1:";
/** Discord's limit without Nitro – the encrypted file info has to fit into the message text */
const MAX_LENGTH = 2000;
/** Bigger files can't be encrypted in memory reliably */
const EXTERNAL_MAX = 1024 * 1024 * 1024;
/** Catbox direct links load and decrypt in the chat; Gofile only has a download page */
const EXTERNAL_LINK = /^https:\/\/(files\.catbox\.moe\/[\w.-]+|gofile\.io\/d\/[\w-]+)$/;
const isGofileLink = (url: string) => url.startsWith("https://gofile.io/");
/** Pictures / videos / audio up to this size load right away, bigger ones on click */
const AUTO_LOAD_MAX = 30 * 1024 * 1024;

interface Manifest {
    v: 1;
    /** name, MIME type, size of the original */
    n: string;
    t: string;
    s: number;
    iv: string;
    /** image / video size, for the placeholder */
    w?: number;
    h?: number;
    /** Over the upload limit: link to the encrypted file on Catbox / Gofile (no Discord attachment then) */
    u?: string;
    /** Voice message (shown with the voice player) */
    vm?: 1;
}

interface FileInfo {
    manifest: Manifest;
    url: string;
    keyId: string;
}

/** message id → its encrypted file */
const files = new Map<string, FileInfo>();
/** message id → decrypted blob URL (one download per session) */
const loaded = new Map<string, Promise<string>>();

// ---------------------------------------------------------------- Receiving (called from the interceptor)

/**
 * Big view of a decrypted image. Discord's own media viewer can't show it: the picture only exists here as a
 * blob: URL, and Discord's viewer runs every image through its media proxy ("Image failed to load").
 */
function openImageViewer(url: string, name: string) {
    openModal(props => (
        <div className={cl("viewer")} onClick={props.onClose}>
            <img src={url} alt={name} onClick={e => e.stopPropagation()} />
            <div className={cl("viewer-bar")} onClick={e => e.stopPropagation()}>
                <span className={cl("viewer-name")}>{name}</span>
                <button type="button" className={cl("viewer-btn")} title="Save the decrypted image" onClick={() => saveDecrypted(url, name)}>Save</button>
                <button type="button" className={cl("viewer-btn")} onClick={props.onClose}>Close</button>
            </div>
        </div>
    ));
}

function parseManifest(text: string): Manifest | null {
    try {
        const m = JSON.parse(text.slice(FILE_MARK.length));
        return m && typeof m.n === "string" && typeof m.iv === "string" && typeof m.t === "string" ? m : null;
    } catch {
        return null;
    }
}

/**
 * The decrypted text is a file message: remember the .bin attachment, take it out of the message (Discord would
 * show it as a download) and return the text to show instead. null = not a file message.
 */
export function takeFile(m: any, plain: string, keyId: string): string | null {
    if (!plain.startsWith(FILE_MARK)) return null;
    const manifest = parseManifest(plain);
    if (!manifest) return null;

    if (manifest.u != null) {
        // Only hosts we know – the link comes from the sender
        if (typeof manifest.u === "string" && EXTERNAL_LINK.test(manifest.u)) files.set(m.id, { manifest, url: manifest.u, keyId });
        return "";
    }
    const attachments: any[] = Array.isArray(m.attachments) ? m.attachments : [];
    const bin = attachments.find(a => /\.bin$/i.test(a?.filename ?? ""));
    if (bin?.url) {
        files.set(m.id, { manifest, url: bin.url, keyId });
        m.attachments = attachments.filter(a => a !== bin);
    }
    return "";
}

// ---------------------------------------------------------------- Sending

function randomName() {
    return toHex(randomBytes(8));
}

function mediaSize(file: File): Promise<{ w?: number; h?: number; }> {
    if (file.type.startsWith("image/")) {
        return createImageBitmap(file).then(b => { const r = { w: b.width, h: b.height }; b.close(); return r; }).catch(() => ({}));
    }
    if (file.type.startsWith("video/")) {
        return new Promise(resolve => {
            const v = document.createElement("video");
            const url = URL.createObjectURL(file);
            const done = (r: { w?: number; h?: number; }) => { URL.revokeObjectURL(url); resolve(r); };
            v.onloadedmetadata = () => done({ w: v.videoWidth, h: v.videoHeight });
            v.onerror = () => done({});
            v.preload = "metadata";
            v.src = url;
        });
    }
    return Promise.resolve({});
}

/**
 * Sends files into an encrypted chat encrypted – one message per file. Chats without a key get the normal upload.
 * Over the upload limit: the encrypted file goes to Catbox (Gofile as fallback) through GofileUpload.
 */
export async function sendEncryptedFiles(channel: Channel, list: File[], messageReference?: unknown, { voice = false } = {}) {
    const record = channelKey(channel.id);
    const key = record && getKeyBytes(record.id);
    const me = UserStore.getCurrentUser()?.id;
    if (!record || !key || !me) return sendPlainFiles(channel, list, messageReference);

    const limit = uploadLimit();
    for (const file of list) {
        // AES-GCM adds 16 bytes
        const external = file.size + 16 > limit;
        if (external && !Settings.plugins.GofileUpload?.enabled) {
            notify({ title: `${file.name} is larger than your upload limit (${formatBytes(limit)})`, body: "Turn on GofileUpload to send big files encrypted", kind: "error", app: "Unter das OS" });
            continue;
        }
        if (file.size > EXTERNAL_MAX) {
            notify({ title: `${file.name} is too large to encrypt (max ${formatBytes(EXTERNAL_MAX)})`, kind: "error", app: "Unter das OS" });
            continue;
        }
        try {
            const { iv, data } = await encryptFile(key, await file.arrayBuffer());
            const manifest: Manifest = { v: 1, n: file.name.slice(0, 120), t: file.type || "application/octet-stream", s: file.size, iv, ...await mediaSize(file) };
            if (voice) manifest.vm = 1;
            const bin = new File([data as BlobPart], `${randomName()}.bin`, { type: "application/octet-stream" });

            if (external) {
                // Over the limit: the encrypted .bin goes to Catbox / Gofile, its link travels in the encrypted text
                const result = await uploadForLink(bin, file.name);
                if (!result) continue;
                manifest.u = result.url;
            }
            const content = encryptMessage(record.id, key, me, FILE_MARK + JSON.stringify(manifest));
            if (content.length > MAX_LENGTH) throw new Error("File name too long");

            const upload = external ? null : await uploadOne(bin, channel.id);
            await RestAPI.post({
                url: Constants.Endpoints.MESSAGES(channel.id),
                body: {
                    channel_id: channel.id,
                    content,
                    nonce: SnowflakeUtils.fromTimestamp(Date.now()),
                    sticker_ids: [],
                    type: 0,
                    attachments: upload ? [attachmentOf(upload, 0)] : [],
                    message_reference: messageReference ?? null
                }
            });
            // Only the first file answers the message
            messageReference = undefined;
        } catch (e) {
            logger.error("Sending an encrypted file failed", e);
            notify({ title: `Couldn't send ${file.name} encrypted`, kind: "error", app: "Unter das OS" });
        }
    }
}

/**
 * Discord's promptToUpload (drop, paste, + button in the normal chat input). In an encrypted chat the files don't
 * go into the draft (Discord would upload them right away, readable) – they are sent encrypted instead.
 * true = handled, Discord does nothing.
 */
export function interceptUpload(files: ArrayLike<File> | null, channel: Channel | null): boolean {
    try {
        if (!files?.length || !channel) return false;
        const list = Array.from(files);
        // The keyring loads a moment after start – never let an "on" chat's files slip out readable
        if (!isLoaded()) {
            notify({ title: "Unter das OS is still loading its keys – try again in a second", kind: "error", app: "Unter das OS" });
            return true;
        }
        if (!channelKey(channel.id)) return false;

        const reply = PendingReplyStore.getPendingReply(channel.id);
        const reference = reply ? MessageActions.getSendMessageOptionsForReply(reply)?.messageReference : undefined;
        notify({ title: list.length === 1 ? `Sending ${list[0].name} encrypted …` : `Sending ${list.length} files encrypted …`, kind: "info", app: "Unter das OS" });
        void sendEncryptedFiles(channel, list, reference);
        return true;
    } catch (e) {
        logger.error("interceptUpload failed", e);
        // Better nothing than a readable file in an encrypted chat
        return channel ? !!channelKey(channel.id) : false;
    }
}

/** ChatPopout windows: their own file sending, encrypted in chats with a key. true = handled */
export function sendFilesOverride(channel: Channel, list: File[], messageReference?: unknown) {
    if (!channelKey(channel.id)) return false;
    void sendEncryptedFiles(channel, list, messageReference);
    return true;
}

// ---------------------------------------------------------------- Showing

/** Phone app (Discord Web): Discord's CDN doesn't allow the download from the page, and there's no main process */
const NO_FILES_HERE = "Open it on your PC – the phone app can't load encrypted files";

async function fetchBytes(url: string): Promise<ArrayBuffer> {
    try {
        const res = await fetch(url);
        if (res.ok) return await res.arrayBuffer();
    } catch { /* CORS – the main process can */ }
    if (!IS_DISCORD_DESKTOP) throw new Error(NO_FILES_HERE);
    if (!Native?.download) throw new Error("Restart Discord completely once to load encrypted files");
    const bytes = await Native.download(url);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Decrypts the file – downloaded, or the .bin the user picked (Gofile) */
function load(messageId: string, info: FileInfo, picked?: File, onDecrypt?: () => void) {
    let p = picked ? undefined : loaded.get(messageId);
    if (!p) {
        p = (async () => {
            const key = getKeyBytes(info.keyId);
            if (!key) throw new Error("The key of this file was deleted");
            const bytes = picked ? await picked.arrayBuffer() : await fetchBytes(info.url);
            onDecrypt?.();
            let plain: ArrayBuffer;
            try {
                plain = await decryptFile(key, info.manifest.iv, bytes);
            } catch {
                throw new Error(picked ? "That's not the file of this message" : "Couldn't decrypt the file");
            }
            return URL.createObjectURL(new Blob([plain], { type: info.manifest.t }));
        })();
        p.catch(() => loaded.delete(messageId));
        loaded.set(messageId, p);
    }
    return p;
}

/** File picker for the .bin downloaded from Gofile */
function pickFile(): Promise<File | null> {
    return new Promise(resolve => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".bin,application/octet-stream";
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.oncancel = () => resolve(null);
        input.click();
    });
}

const kindOf = (m: Manifest) => m.vm === 1 ? "voice" : kindOfType(m.t);
const kindOfType = (type: string) => type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : type.startsWith("audio/") ? "audio" : "file";

/** Fits the media into 400 × 300 like Discord's attachments */
function box(m: Manifest) {
    if (!m.w || !m.h) return { width: 300, height: 200 };
    const scale = Math.min(1, 400 / m.w, 300 / m.h);
    return { width: Math.round(m.w * scale), height: Math.round(m.h * scale) };
}

export function EncryptedFile({ message }: { message: Message; }) {
    const info = files.get(message.id);
    const kind = info ? kindOf(info.manifest) : "file";
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [phase, setPhase] = useState("Loading…");
    const { emergency } = settings.use(["emergency"]);

    // Gofile has only a download page: the user downloads the .bin there and picks it here
    const gofile = !!info && isGofileLink(info.url);
    // Pictures, videos and audio load right away (big ones on click), other files on click
    const auto = !!info && kind !== "file" && !gofile && info.manifest.s <= AUTO_LOAD_MAX;

    const start = (picked?: File, feedback = false) => {
        if (!info || busy) return Promise.resolve(null);
        const card = feedback ? createFileProgress(info.manifest.n) : null;
        const phase = picked ? "Reading encrypted file…" : "Downloading encrypted file…";
        setPhase(phase);
        card?.update(phase);
        setBusy(true);
        setError(null);
        return load(message.id, info, picked, () => { setPhase("Decrypting…"); card?.update("Decrypting…"); })
            .then(u => { setUrl(u); card?.finish("done", "File decrypted"); return u; })
            .catch(e => {
                logger.error("Loading an encrypted file failed", e);
                const text = String(e?.message ?? e);
                setError(text);
                card?.finish("error", text);
                return null;
            })
            .finally(() => setBusy(false));
    };

    useEffect(() => {
        if (!info || emergency) return;
        // Already decrypted this session (e.g. a Gofile file picked before)
        if (auto || loaded.has(message.id)) start();
    }, [message.id, emergency]);

    // Emergency stop: nothing decrypted stays on screen
    if (!info || emergency) return null;
    const m = info.manifest;

    const save = (u: string) => saveDecrypted(u, m.n);

    const download = async () => {
        const u = url ?? await start(undefined, true);
        if (u) await save(u);
    };

    const decryptDownloaded = async () => {
        const picked = await pickFile();
        if (!picked) return;
        const u = await start(picked, true);
        if (u && kind === "file") await save(u);
    };

    const badge = (
        <span className={cl("file-badge")} title="Encrypted – only people with the key can see it">
            <Icon path={LOCK_ICON} size={10} />
            Encrypted
        </span>
    );

    const infoButton = (
        <Tooltip text="Where is it stored, how is it encrypted – with a check">
            {(tip: any) => (
                <button
                    {...tip}
                    className={cl("file-info")}
                    aria-label="File info"
                    onClick={e => { e.stopPropagation(); openFileInfo(info, fetchBytes, pickFile); }}
                >
                    <Icon path={ICONS.info} size={16} />
                </button>
            )}
        </Tooltip>
    );

    // Voice messages and audio files: our player, only a lock – green = decrypted, red = couldn't be decrypted
    const audioRow = (
        <div className={cl("voice")}>
            {url ? <VoicePlayer src={url} /> : error ? (
                <>
                    <span className={cl("voice-wait")}>Couldn't decrypt</span>
                    <Button small variant="gray" onClick={() => start(undefined, true)}>Retry</Button>
                </>
            ) : <span className={cl("voice-wait")}>{busy ? phase : "Loading …"}</span>}
            <Tooltip text={error ? `Not decrypted: ${error}` : "Encrypted – only people with the key can hear it"}>
                {(tip: any) => (
                    <span {...tip} className={`${cl("voice-lock")} ${error ? cl("voice-lock-bad") : ""}`}>
                        <LockIcon width={14} height={14} />
                    </span>
                )}
            </Tooltip>
            {infoButton}
        </div>
    );

    if (kind === "voice" && (auto || url || error)) return audioRow;

    // Audio files (e.g. a clip): name and size above the player, like Discord's audio attachments
    if (kind === "audio" && (auto || url || error)) return (
        <div className={cl("audio")}>
            <div className={cl("audio-head")}>
                <span className={cl("audio-name")} title={m.n}>{m.n}</span>
                <span className={cl("audio-size")}>{formatBytes(m.s)}</span>
                {url && (
                    <Tooltip text="Save the decrypted file">
                        {(tip: any) => (
                            <button {...tip} className={cl("file-info")} aria-label="Save" onClick={() => save(url)}>
                                <Icon path={ICONS.download} size={16} />
                            </button>
                        )}
                    </Tooltip>
                )}
            </div>
            {audioRow}
        </div>
    );

    if (kind !== "file" && !error && (auto || url)) {
        const size = box(m);
        return (
            <div className={cl("file")}>
                {!url ? (
                    <div className={cl("file-wait")} style={size}>
                        {busy ? phase : "Loading …"}
                    </div>
                ) : kind === "image" ? (
                    <img
                        className={cl("file-media")}
                        src={url}
                        alt={m.n}
                        style={size}
                        onClick={() => openImageViewer(url, m.n)}
                    />
                ) : (
                    <VideoPlayer src={url} name={m.n} style={size} />
                )}
                {badge}
                {infoButton}
            </div>
        );
    }

    return (
        <div className={cl("file-card")}>
            <Icon path={ICONS.file} size={30} className={cl("file-icon")} />
            <div className={cl("file-meta")}>
                <span className={cl("file-name")}>{m.n}</span>
                <span className={cl("file-size")}>
                    {error ? <span className={cl("file-error")}>{error}</span> : gofile ? `${formatBytes(m.s)} · on Gofile` : formatBytes(m.s)}
                </span>
            </div>
            {badge}
            {infoButton}
            {gofile ? (
                <>
                    <Button small variant="gray" title="Download the .bin there – it can only be opened with the key" onClick={() => VencordNative.native.openExternal(info.url)}>
                        Open Gofile
                    </Button>
                    <Button small disabled={busy} title="Pick the .bin you downloaded from Gofile" onClick={url ? () => save(url) : decryptDownloaded}>
                        {busy ? phase : url ? "Save" : "Decrypt .bin"}
                    </Button>
                </>
            ) : error === NO_FILES_HERE ? null : (
                <Button small disabled={busy} onClick={error ? () => start(undefined, true) : kind === "file" ? download : () => start(undefined, true)}>
                    {busy ? phase : error ? "Retry" : kind === "file" ? "Download" : "Show"}
                </Button>
            )}
        </div>
    );
}
