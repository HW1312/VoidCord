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
import { filters, findComponentByCodeLazy, mapMangledModuleLazy } from "@webpack";
import { ChannelActionCreators, ChannelStore, GuildStore, IconUtils, Popout, RelationshipStore, useEffect, useMemo, useRef, UserStore, useState } from "@webpack/common";
import type { CSSProperties } from "react";

import { AppIcon, Avatar, Button, confirm, Empty, Field, Icon, IconButton, ICONS, LinkRow, Note, notify, openWindow, Popover, Progress, RoundButton, Row, SearchField, Section, Segmented, Sheet, Spinner, TextField, ToggleRow, useListener } from "../_ui";
import { callChannel, Clip, clipListeners, clipState, deleteClip, loadTracks, makeClip, openFolder, readClip, refresh, renameClip, sendClipTo, sendToChat, showInFolder, trimClip } from "./clips";
import { RATE } from "./encode";
import { applyHotkey, settings } from "./index";
import { listeners, MicMode, state } from "./recorder";

const cl = classNameFactory("vc-callclips-");
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');
const POPOUT_STYLE: CSSProperties = { maxHeight: "min(720px, calc(100vh - 72px))" };
/** Discord's own voice panel button (noise suppression, disconnect …), so the clip button looks the same */
const { PanelButton } = mapMangledModuleLazy("Masks.PANEL_BUTTON", { PanelButton: filters.byCode("tooltipPositionKey") });

export const REPLAY_PATH = "M12 5V2.2a.5.5 0 0 0-.85-.36L7.2 5.8a.5.5 0 0 0 0 .7l3.95 3.95a.5.5 0 0 0 .85-.35V7a6 6 0 1 1-6 6.4 1 1 0 0 0-2 .1A8 8 0 1 0 12 5Z";
const SEND_PATH = "M3.4 20.4 20.85 12.9a1 1 0 0 0 0-1.84L3.4 3.6a.99.99 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91Z";
const TRIM_PATH = "M9.64 7.64A4 4 0 1 0 6 10c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36A4 4 0 1 0 10 18c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64ZM6 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 12a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm13-17-6 6 2 2 7-7V3h-3Z";
const PAUSE_PATH = "M7 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm7 0h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z";
const KEY_PATH = "M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm-9 3h2v2h-2V8Zm0 3h2v2h-2v-2ZM8 8h2v2H8V8Zm0 3h2v2H8v-2Zm-1 2H5v-2h2v2Zm0-3H5V8h2v2Zm9 7H8v-2h8v2Zm0-4h-2v-2h2v2Zm0-3h-2V8h2v2Zm3 3h-2v-2h2v2Zm0-3h-2V8h2v2Z";

const LENGTHS = [15, 30, 60, 120];

// ---------------------------------------------------------------- Helpers

/** 1:05, or 1:05.3 with tenths */
function formatTime(seconds: number, tenths = false) {
    const t = Math.max(0, tenths ? Math.round(seconds * 10) / 10 : Math.round(seconds));
    const s = Math.floor(t % 60);
    const rest = tenths ? `.${Math.round((t % 1) * 10) % 10}` : "";
    return `${Math.floor(t / 60)}:${String(s).padStart(2, "0")}${rest}`;
}

function formatWhen(ms: number) {
    const d = new Date(ms);
    const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return `Today ${time}`;
    const yesterday = new Date(today.getTime() - 86_400_000);
    if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

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

// ---------------------------------------------------------------- Windows

function RenameSheet({ clip, onClose }: { clip: Clip; onClose(): void; }) {
    const [name, setName] = useState(nameOf(clip.file));
    const save = () => guard("rename the clip", async () => {
        await renameClip(clip, name);
        onClose();
    });
    return (
        <Sheet
            header={{ title: "Rename clip", icon: ICONS.edit, iconColor: "red" }}
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

function TrimSheet({ clip, onClose }: { clip: Clip; onClose(): void; }) {
    const [tracks, setTracks] = useState<Float32Array[] | null>(null);
    const [error, setError] = useState("");
    const [range, setRange] = useState<[number, number]>([0, 0]);
    const [time, setTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [saving, setSaving] = useState(false);
    const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
    const rangeRef = useRef(range);
    rangeRef.current = range;

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
            setRange([0, t[0].length / RATE]);
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

    return (
        <Sheet
            header={{ title: "Trim clip", subtitle: nameOf(clip.file), icon: TRIM_PATH, iconColor: "red" }}
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
                            <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor"><path d={playing ? PAUSE_PATH : ICONS.play} /></svg>
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

const openTrim = (clip: Clip) => {
    stopPlayback();
    openWindow(close => <TrimSheet clip={clip} onClose={close} />, { size: "medium", className: cl("fit-window") });
};

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
const GROUP_PATH = "M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05A4.22 4.22 0 0 1 17 16.5V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z";
const SPEAKER_PATH = "M3 10v4a1 1 0 0 0 1 1h3l3.7 3.7a.75.75 0 0 0 1.3-.53V5.83a.75.75 0 0 0-1.3-.53L7 9H4a1 1 0 0 0-1 1Zm13.5 2A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12ZM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54Z";

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
            header={{ title: "Send clip", subtitle: nameOf(clip.file), icon: SEND_PATH, iconColor: "red" }}
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

function ClipRow({ clip, onSent }: { clip: Clip; onSent?(): void; }) {
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
                formatWhen(clip.created ?? clip.modified)
            ].filter(Boolean).join(" · ")}
            trailing={
                <div className={cl("actions")}>
                    <IconButton icon={SEND_PATH} label="Send into a chat" onClick={() => guard("send the clip", () => sendClip(clip, onSent))} />
                    <IconButton icon={TRIM_PATH} label="Trim" onClick={() => openTrim(clip)} />
                    <IconButton icon={ICONS.edit} label="Rename" onClick={() => openRename(clip)} />
                    <IconButton icon={ICONS.folder} label="Show in folder" onClick={() => showInFolder(clip)} />
                    <IconButton icon={ICONS.trash} label="Delete" destructive onClick={remove} />
                </div>
            }
        >
            {current && length ? <Progress value={player.time / length * 100} color="red" /> : null}
        </Row>
    );
}

function ClipsSheet({ embedded, onClose }: { embedded?: boolean; onClose(): void; }) {
    useListener(listeners);
    useListener(clipListeners);
    const { seconds, hotkey } = settings.use(["seconds", "hotkey"]);

    useEffect(() => {
        void refresh();
        return stopPlayback;
    }, []);

    const subtitle = state.running ? `Recording · last ${seconds} s` : "Join a voice call to clip";

    return (
        <Sheet
            embedded={embedded}
            onClose={onClose}
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
                    <Button wide color="red" icon={REPLAY_PATH} disabled={!state.running || clipState.busy} onClick={() => void makeClip()}>
                        {clipState.busy ? "Saving…" : `Clip last ${seconds} s`}
                    </Button>
                    <span className={cl("dim")}>{hotkey ? `or press ${hotkey} – also in games` : "Set a shortcut in the plugin settings"}</span>
                    {state.error && !state.running && <Note tone="bad">Recording failed: {state.error}</Note>}
                </div>
            }
        >
            {!clipState.loaded ? (
                <div className={cl("loading")}><Spinner /> Loading clips…</div>
            ) : !clipState.clips.length ? (
                <Empty icon={REPLAY_PATH} title="No clips yet" hint="While you're in a call, the last seconds are kept. Clip them with the button or your shortcut." />
            ) : (
                <Section title={`${clipState.clips.length} clip${clipState.clips.length === 1 ? "" : "s"}`}>
                    {clipState.clips.map(c => <ClipRow key={c.file} clip={c} onSent={embedded ? undefined : onClose} />)}
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
                            <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" className="vc-ui-tb-icon"><path d={REPLAY_PATH} /></svg>
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

const CHECK_PATH = "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z";

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
            icon={({ width = 20, height = 20 }: { width?: number; height?: number; }) => (
                <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" className={done ? cl("panel-done") : undefined}>
                    <path d={done ? CHECK_PATH : REPLAY_PATH} />
                </svg>
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
    const s = settings.use(["seconds", "micMode", "showTitleBarButton", "showPanelButton"]);
    return (
        <Sheet embedded header={{ app: "CallClips", title: "CallClips", subtitle: "Clip the last seconds of a voice call", icon: REPLAY_PATH, iconColor: "red" }}>
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
                <ToggleRow icon={REPLAY_PATH} color="red" title="Clip button in the voice panel" subtitle="Bottom left while you're in a call – right-click it for all clips" checked={s.showPanelButton} onChange={v => settings.store.showPanelButton = v} />
                <ToggleRow icon={REPLAY_PATH} color="red" title="Show icon in the title bar" checked={s.showTitleBarButton} onChange={v => settings.store.showTitleBarButton = v} />
                <LinkRow icon={ICONS.folder} onClick={() => void openFolder()}>Open clips folder</LinkRow>
                <LinkRow icon={REPLAY_PATH} onClick={openClipsWindow}>Show clips</LinkRow>
            </Section>
        </Sheet>
    );
}, { noop: true });
