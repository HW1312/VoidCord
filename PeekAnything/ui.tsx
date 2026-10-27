/*
 * PeekAnything – floating preview card, stream & voice views, settings
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { findByPropsLazy } from "@webpack";
import {
    ApplicationStreamingStore, ApplicationStreamPreviewStore, ChannelRTCStore, ChannelStore, createRoot, GuildMemberStore, GuildStore, IconUtils,
    MediaEngineStore, NavigationRouter, SelectedChannelStore, useEffect, useLayoutEffect, useRef, UserStore, useState, useStateFromStores, VoiceStateStore
} from "@webpack/common";
import type { Root } from "react-dom/client";

import { Button, classes, Icon, IconButton, ICONS, Row, Section, Segmented, Sheet, Spinner, strokeIcon, TextField, ToggleRow } from "../_ui";
import { ChatPreview } from "./chat";
import { closePeek, getState, PeekState, setCallIndex, subscribe, switchTo } from "./controller";
import { cl, logger, settings } from "./index";
import { acquireStream, fetchPreview, inVoiceChannel, releaseStream, StreamRef, toggleStreamMute } from "./streams";
import { streamFor, streamsIn, Target, targetKey } from "./targets";

const ChannelActions = findByPropsLazy("selectVoiceChannel", "selectChannel");

// ---------------------------------------------------------------- Icons

/** Circle as path data (for Lucide icons drawn with strokeIcon) */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
const SPEAKER = "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z";

// Thin Lucide strokes like the kit; shared meanings come from the kit's ICONS (they have their own button animations)
const PIN_PATH = strokeIcon("M12 17v5", "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z");
const OPEN_PATH = ICONS.external;
const SPEAKER_PATH = strokeIcon(SPEAKER, "M16 9a5 5 0 0 1 0 6");
const MUTED_PATH = strokeIcon(SPEAKER, "m22 9-6 6", "m16 9 6 6");
const MIC_OFF_PATH = strokeIcon("M12 19v3", "M15 9.34V5a3 3 0 0 0-5.68-1.33", "M16.95 16.95A7 7 0 0 1 5 12v-2", "M18.89 13.23A7 7 0 0 0 19 12v-2", "m2 2 20 20", "M9 9v3a3 3 0 0 0 5.12 2.12");
const DEAF_PATH = strokeIcon("M21 14h-1.343", "M9.128 3.47A9 9 0 0 1 21 12v3.343", "m2 2 20 20", "M20.414 20.414A2 2 0 0 1 19 21h-1a2 2 0 0 1-2-2v-3", "M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 2.636-6.364");
const VIDEO_PATH = strokeIcon("m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5", "M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z");
const HASH_PATH = ICONS.hash;

export const ICON_COLOR = "indigo";
const EYE_PATH = strokeIcon("M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0", circle(12, 12, 3));

function HeadButton({ path, label, onClick, active }: { path: string; label: string; onClick(): void; active?: boolean; }) {
    return <IconButton icon={path} label={label} onClick={onClick} active={active} />;
}

// ---------------------------------------------------------------- Helpers

function userName(userId: string, guildId: string | null) {
    const u: any = UserStore.getUser(userId);
    return (guildId && GuildMemberStore.getNick(guildId, userId)) || u?.globalName || u?.username || "Unknown";
}

function userAvatar(userId: string, size = 32) {
    const u: any = UserStore.getUser(userId);
    return u ? IconUtils.getUserAvatarURL(u, false, size) : IconUtils.getDefaultAvatarURL(userId);
}

function channelLabel(channelId: string) {
    const channel: any = ChannelStore.getChannel(channelId);
    if (!channel) return { name: "Unknown channel", icon: null as string | null, sub: "", guildId: null as string | null };
    if (channel.isDM?.()) {
        const id = channel.recipients?.[0];
        return { name: id ? userName(id, null) : "Direct Message", icon: id ? userAvatar(id) : null, sub: "", guildId: null };
    }
    if (channel.isPrivate?.()) {
        const names = (channel.recipients ?? []).map((id: string) => userName(id, null)).join(", ");
        return { name: channel.name || names || "Group", icon: IconUtils.getChannelIconURL({ id: channel.id, icon: channel.icon, size: 32 }) ?? null, sub: "", guildId: null };
    }
    const guild = GuildStore.getGuild(channel.guild_id);
    return { name: channel.name, icon: null, sub: guild?.name ?? "", guildId: channel.guild_id as string };
}

function openChannel(channelId: string, messageId?: string) {
    const guildId = ChannelStore.getChannel(channelId)?.guild_id ?? "@me";
    closePeek();
    NavigationRouter.transitionTo(`/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ""}`);
}

function joinVoice(channelId: string) {
    try {
        ChannelActions.selectVoiceChannel(channelId);
    } catch (e) {
        logger.error("Couldn't join voice channel", e);
    }
}

function PinMark({ pinned }: { pinned: boolean; }) {
    if (!pinned) return null;
    return <span className={cl("pin")} title="Pinned (Esc or click outside to close)"><Icon path={PIN_PATH} size={12} /></span>;
}

// ---------------------------------------------------------------- Chat

function ChatCard({ channelId, messageId, pinned }: { channelId: string; messageId?: string; pinned: boolean; }) {
    const info = channelLabel(channelId);
    return (
        <>
            <header className={cl("head")}>
                {info.icon
                    ? <img className={cl("head-avatar")} src={info.icon} alt="" />
                    : <Icon path={HASH_PATH} size={14} className={cl("head-hash")} />}
                <span className={cl("head-name")} title={info.name}>{info.name}</span>
                {info.sub && <span className={cl("head-sub")}>{info.sub}</span>}
                <PinMark pinned={pinned} />
                <HeadButton path={OPEN_PATH} label={messageId ? "Jump to message" : "Open channel"} onClick={() => openChannel(channelId, messageId)} />
            </header>
            <ErrorBoundary message="Messages could not be displayed.">
                <ChatPreview channelId={channelId} guildId={info.guildId} messageId={messageId} />
            </ErrorBoundary>
        </>
    );
}

// ---------------------------------------------------------------- Stream

function useStreamId(ref: StreamRef) {
    return useStateFromStores([ChannelRTCStore], () => {
        const p: any = (ChannelRTCStore.getParticipants(ref.channelId) ?? []).find((x: any) => x?.stream && x.user?.id === ref.userId);
        return (p?.streamId as string | undefined) ?? null;
    });
}

function StreamView({ stream }: { stream: StreamRef; }) {
    const inVc = useStateFromStores([SelectedChannelStore], () => inVoiceChannel(stream.channelId));
    const live = useStateFromStores([ApplicationStreamingStore], () => !!streamFor(stream.userId, stream.channelId));
    const preview = useStateFromStores([ApplicationStreamPreviewStore], () => ApplicationStreamPreviewStore.getPreviewURLForStreamKey(stream.streamKey) ?? null);
    const streamId = useStreamId(stream);
    const Video: any = MediaEngineStore.getVideoComponent?.();

    useEffect(() => {
        fetchPreview(stream);
    }, [stream.streamKey]);

    useEffect(() => {
        if (!live) return;
        acquireStream(stream);
        return () => releaseStream(stream.streamKey);
    }, [stream.streamKey, inVc, live]);

    if (!live) return <div className={cl("video")}><div className={cl("overlay")}>The stream has ended.</div></div>;

    return (
        <div className={cl("video")}>
            {preview && <img className={cl("preview")} src={preview} alt="" />}
            {inVc && streamId && Video && (
                <ErrorBoundary noop>
                    <Video streamId={streamId} fit="contain" paused={false} mirror={false} className={cl("media")} />
                </ErrorBoundary>
            )}
            {inVc && !streamId && <div className={cl("overlay")}><Spinner size={18} /></div>}
            {!inVc && (
                <div className={cl("overlay")}>
                    <Button small onClick={() => joinVoice(stream.channelId)}>Join &amp; watch</Button>
                </div>
            )}
        </div>
    );
}

function StreamMute({ stream }: { stream: StreamRef; }) {
    const muted = useStateFromStores([MediaEngineStore], () => {
        try {
            return MediaEngineStore.isLocalMute(stream.userId, "stream" as any);
        } catch {
            return false;
        }
    });
    const inVc = useStateFromStores([SelectedChannelStore], () => inVoiceChannel(stream.channelId));
    if (!inVc) return null;
    return <HeadButton path={muted ? MUTED_PATH : SPEAKER_PATH} label={muted ? "Unmute stream" : "Mute stream"} active={muted} onClick={() => toggleStreamMute(stream.userId)} />;
}

function StreamHead({ stream, pinned, children }: { stream: StreamRef; pinned: boolean; children?: React.ReactNode; }) {
    const channel = ChannelStore.getChannel(stream.channelId);
    return (
        <header className={cl("head")}>
            <img className={cl("head-avatar")} src={userAvatar(stream.userId)} alt="" />
            <span className={cl("head-name")}>{userName(stream.userId, stream.guildId)}</span>
            <span className={cl("live")}>LIVE</span>
            {channel?.name && <span className={cl("head-sub")}>{channel.name}</span>}
            {children}
            <PinMark pinned={pinned} />
            <StreamMute stream={stream} />
        </header>
    );
}

function StreamCard({ stream, pinned }: { stream: StreamRef; pinned: boolean; }) {
    return (
        <>
            <StreamHead stream={stream} pinned={pinned} />
            <StreamView stream={stream} />
        </>
    );
}

function CallCard({ index, pinned }: { index: number; pinned: boolean; }) {
    // Comma joined keys keep the store hook's comparison stable
    const keys = useStateFromStores([ApplicationStreamingStore, SelectedChannelStore], () =>
        streamsIn(SelectedChannelStore.getVoiceChannelId()).map(s => s.streamKey).join(","));
    const streams = streamsIn(SelectedChannelStore.getVoiceChannelId());

    useEffect(() => {
        if (!keys) closePeek();
    }, [keys]);

    if (!streams.length) return null;
    const i = Math.min(index, streams.length - 1);
    const stream = streams[i];

    return (
        <>
            <StreamHead stream={stream} pinned={pinned}>
                {streams.length > 1 && (
                    <span className={cl("dots")} title="Scroll or use the arrow keys to switch">
                        {streams.map((s, n) => (
                            <button key={s.streamKey} className={classes(cl("dot"), n === i && cl("dot-active"))} aria-label={`Stream ${n + 1}`} onClick={() => setCallIndex(n)} />
                        ))}
                    </span>
                )}
            </StreamHead>
            <StreamView key={stream.streamKey} stream={stream} />
        </>
    );
}

// ---------------------------------------------------------------- Voice channel

function VoiceCard({ channelId, pinned }: { channelId: string; pinned: boolean; }) {
    const channel: any = ChannelStore.getChannel(channelId);
    const guildId: string | null = channel?.guild_id ?? null;
    const me = UserStore.getCurrentUser()?.id;
    const inVc = useStateFromStores([SelectedChannelStore], () => inVoiceChannel(channelId));

    // Serialized so the store hook only re-renders on real changes
    const raw = useStateFromStores([VoiceStateStore, ApplicationStreamingStore], () => {
        const states: Record<string, any> = VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
        return JSON.stringify(Object.values(states).map((s: any) => [
            s.userId,
            !!(s.selfMute || s.mute || s.suppress),
            !!(s.selfDeaf || s.deaf),
            !!s.selfVideo,
            !!streamFor(s.userId, channelId)
        ]));
    });
    const people: [string, boolean, boolean, boolean, boolean][] = JSON.parse(raw);
    people.sort((a, b) => Number(b[4]) - Number(a[4]) || userName(a[0], guildId).localeCompare(userName(b[0], guildId)));

    const watch = (userId: string) => {
        const t = streamFor(userId, channelId);
        if (t && settings.store.streams) switchTo({ target: t, anchor: null });
    };

    return (
        <>
            <header className={cl("head")}>
                <Icon path={SPEAKER_PATH} size={14} className={cl("head-hash")} />
                <span className={cl("head-name")}>{channel?.name ?? "Voice channel"}</span>
                <span className={cl("head-sub")}>{people.length}</span>
                <PinMark pinned={pinned} />
                {!inVc && <span className={cl("head-end")}><Button small onClick={() => joinVoice(channelId)}>Join</Button></span>}
            </header>
            <div className={cl("voice-list")}>
                {!people.length && <div className={cl("muted-line")}>Nobody is here.</div>}
                {people.map(([userId, muted, deaf, video, live]) => (
                    <div
                        key={userId}
                        className={classes(cl("voice-row"), live && userId !== me && cl("voice-row-live"))}
                        onClick={live && userId !== me ? () => watch(userId) : undefined}
                        title={live && userId !== me ? "Show stream" : undefined}
                    >
                        <img className={cl("voice-avatar")} src={userAvatar(userId, 32)} alt="" />
                        <span className={cl("voice-name")}>{userName(userId, guildId)}</span>
                        {live && <span className={cl("live")}>LIVE</span>}
                        {video && <Icon path={VIDEO_PATH} size={13} className={cl("voice-icon")} />}
                        {muted && <Icon path={MIC_OFF_PATH} size={13} className={cl("voice-icon")} />}
                        {deaf && <Icon path={DEAF_PATH} size={13} className={cl("voice-icon")} />}
                    </div>
                ))}
            </div>
        </>
    );
}

// ---------------------------------------------------------------- Card & placement

const MARGIN = 8;

const CALL_MIN_W = 240;
const CALL_MAX_W = 1200;

function placeCard(card: HTMLElement, rect: DOMRect | null) {
    const W = window.innerWidth, H = window.innerHeight;
    // The call preview remembers where the user dragged it and how wide they made it
    const saved = !rect ? settings.store.callBox : null;
    if (saved) card.style.width = `${Math.max(CALL_MIN_W, Math.min(saved.width, W - 2 * MARGIN))}px`;

    const w = card.offsetWidth, h = card.offsetHeight;
    let left: number, top: number;

    if (saved) {
        left = saved.left;
        top = saved.top;
    } else if (!rect) {
        // Call peek: bottom right, above the chat input
        const box = document.querySelector('[class*="channelTextArea_"]')?.getBoundingClientRect();
        if (box?.width) {
            left = box.right - w;
            top = box.top - h - MARGIN;
        } else {
            left = W - w - 16;
            top = H - h - 90;
        }
    } else if (rect.right + MARGIN + w <= W - MARGIN) {
        left = rect.right + MARGIN;
        top = rect.top - 6;
    } else if (rect.left - MARGIN - w >= MARGIN) {
        left = rect.left - MARGIN - w;
        top = rect.top - 6;
    } else {
        left = rect.left;
        top = rect.bottom + MARGIN + h <= H - MARGIN ? rect.bottom + MARGIN : rect.top - MARGIN - h;
    }

    left = Math.max(MARGIN, Math.min(left, W - w - MARGIN));
    top = Math.max(MARGIN, Math.min(top, H - h - MARGIN));
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
    card.style.visibility = "visible";
}

function CardBody({ target, pinned, callIndex }: { target: Target; pinned: boolean; callIndex: number; }) {
    switch (target.kind) {
        case "chat": return <ChatCard channelId={target.channelId} messageId={target.messageId} pinned={pinned} />;
        case "stream": return <StreamCard stream={target} pinned={pinned} />;
        case "voice": return <VoiceCard channelId={target.channelId} pinned={pinned} />;
        case "call": return <CallCard index={callIndex} pinned={pinned} />;
    }
}

/** Drag the call preview by its header or resize it by the corner; the result is saved for next time */
function startCallDrag(e: React.MouseEvent<HTMLDivElement>, mode: "move" | "resize") {
    const card = e.currentTarget.closest<HTMLElement>(`.${cl("card")}`);
    if (!card || e.button !== 0) return;
    if (mode === "move" && (e.target as HTMLElement).closest("button, a, input")) return;
    e.preventDefault();

    const start = card.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    card.classList.add(cl("dragging"));

    const onMove = (ev: MouseEvent) => {
        const W = window.innerWidth, H = window.innerHeight;
        if (mode === "move") {
            const left = Math.max(MARGIN, Math.min(start.left + ev.clientX - sx, W - start.width - MARGIN));
            const top = Math.max(MARGIN, Math.min(start.top + ev.clientY - sy, H - card.offsetHeight - MARGIN));
            card.style.left = `${Math.round(left)}px`;
            card.style.top = `${Math.round(top)}px`;
        } else {
            const max = Math.min(CALL_MAX_W, W - start.left - MARGIN);
            card.style.width = `${Math.round(Math.max(CALL_MIN_W, Math.min(start.width + ev.clientX - sx, max)))}px`;
        }
    };
    const onUp = () => {
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", onUp, true);
        card.classList.remove(cl("dragging"));
        const box = card.getBoundingClientRect();
        settings.store.callBox = { left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width) };
    };
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
}

function Card({ state }: { state: PeekState; }) {
    const ref = useRef<HTMLDivElement>(null);
    const { hit, rect, pinned, callIndex } = state;
    const { kind } = hit!.target;
    const isCall = kind === "call";

    useLayoutEffect(() => {
        const card = ref.current;
        if (!card) return;
        placeCard(card, rect);
        // While the user drags/resizes, the card follows the mouse instead of being re-placed
        const ro = new ResizeObserver(() => !card.classList.contains(cl("dragging")) && placeCard(card, rect));
        ro.observe(card);
        return () => ro.disconnect();
    }, [rect]);

    return (
        <div
            ref={ref}
            className={classes(cl("card"), cl(`card-${kind}`), pinned && cl("card-pinned"))}
            style={{ visibility: "hidden" }}
            onMouseDown={isCall ? e => (e.target as HTMLElement).closest(`.${cl("head")}`) && startCallDrag(e, "move") : undefined}
        >
            <ErrorBoundary message="Preview could not be displayed.">
                <CardBody target={hit!.target} pinned={pinned} callIndex={callIndex} />
            </ErrorBoundary>
            {isCall && (
                <div
                    className={cl("resize")}
                    title="Drag to resize"
                    onMouseDown={e => { e.stopPropagation(); startCallDrag(e, "resize"); }}
                />
            )}
        </div>
    );
}

function PeekRoot() {
    const [state, setState] = useState(getState);
    useEffect(() => subscribe(() => setState(getState())), []);
    if (!state.hit) return null;
    // A new target remounts the card (fresh animation & placement)
    return <Card key={targetKey(state.hit.target)} state={state} />;
}

// ---------------------------------------------------------------- Mounting

let host: HTMLDivElement | null = null;
let root: Root | null = null;

export function mountRoot() {
    if (root) return;
    host = document.createElement("div");
    host.className = "vc-peek-root";
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
        <ErrorBoundary noop>
            <PeekRoot />
        </ErrorBoundary>
    );
}

export function unmountRoot() {
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
}

// ---------------------------------------------------------------- Settings

const KEY_OPTIONS: { value: "alt" | "ctrl" | "shift" | "custom"; label: string; }[] = [
    { value: "alt", label: "Alt" },
    { value: "ctrl", label: "Ctrl" },
    { value: "shift", label: "Shift" },
    { value: "custom", label: "Custom" }
];

const TARGETS = [
    ["channels", "Channels, threads & DMs in the sidebar"],
    ["messageLinks", "Message links in chat"],
    ["streams", "Streaming users in voice channels"],
    ["voiceChannels", "Voice channels (who is in there)"],
    ["callStreams", "Streams in your current call (nothing hovered)"]
] as const;

function KeyRecorder() {
    const { customKey } = settings.use(["customKey"]);
    const [recording, setRecording] = useState(false);

    useEffect(() => {
        if (!recording) return;
        const onKey = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.key !== "Escape") settings.store.customKey = e.code;
            setRecording(false);
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [recording]);

    return (
        <Button small variant={recording ? "filled" : "gray"} color={recording ? "orange" : "blue"} onClick={() => setRecording(r => !r)}>
            {recording ? "Press a key …" : customKey || "Record key"}
        </Button>
    );
}

function NumberField({ value, min, max, onChange }: { value: number; min: number; max: number; onChange(v: number): void; }) {
    return (
        <TextField
            className={cl("number")}
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={v => onChange(Math.max(min, Math.min(max, Math.round(Number(v) || 0))))}
        />
    );
}

export const SettingsPanel = ErrorBoundary.wrap(() => {
    const s = settings.use(["key", "holdDelay", "keepStreamSeconds", "muteStream", "callBox", ...TARGETS.map(([k]) => k)]);

    return (
        <Sheet
            embedded
            header={{
                app: "PeekAnything", title: "PeekAnything",
                subtitle: "Click into a preview to pin it, Esc or a click outside closes it. Peeking never marks anything as read.",
                icon: EYE_PATH,
                iconColor: ICON_COLOR
            }}
        >
            <Section>
                <Row
                    title="Hold this key to peek"
                    trailing={
                        <span className={cl("option-right")}>
                            <Segmented small value={s.key} options={KEY_OPTIONS} onChange={v => settings.store.key = v} />
                            {s.key === "custom" && <KeyRecorder />}
                        </span>
                    }
                />
                <Row title="Hold delay (ms)" trailing={<NumberField value={s.holdDelay} min={0} max={2000} onChange={v => settings.store.holdDelay = v} />} />
                <Row title="Keep stream connected after a peek (seconds)" trailing={<NumberField value={s.keepStreamSeconds} min={0} max={600} onChange={v => settings.store.keepStreamSeconds = v} />} />
                <ToggleRow title="Mute the audio of peeked streams" checked={s.muteStream} onChange={v => settings.store.muteStream = v} />
                <Row
                    title="Call stream preview position & size"
                    trailing={
                        <Button small variant="gray" disabled={!s.callBox} onClick={() => settings.store.callBox = null}>
                            {s.callBox ? "Reset" : "Default"}
                        </Button>
                    }
                />
            </Section>

            <Section title="Peek at">
                {TARGETS.map(([key, label]) => (
                    <ToggleRow key={key} title={label} checked={s[key]} onChange={v => settings.store[key] = v} />
                ))}
            </Section>
        </Sheet>
    );
}, { noop: true });
