/*
 * ChatPopout – shared building blocks (icons, tooltips, media helpers, markdown)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory, vencordRootNode } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { GuildMemberStore, IconUtils, Parser, useEffect, useLayoutEffect, useMemo, UserStore, useState } from "@webpack/common";

import { ICONS, Icon as UiIcon, strokeIcon } from "../_ui";

export const cl = classNameFactory("vc-chatpopout-");
export const log = new Logger("ChatPopout");

// ---------------------------------------------------------------- Icons

/** Circle as path data, so every icon part is a path */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

// Thin stroke icons (Lucide). Kit icons where the kit has the meaning, the rest built with strokeIcon.
export const POPOUT_PATH = ICONS.external;
export const CLOSE_PATH = ICONS.close;
// minus
export const MIN_PATH = strokeIcon("M5 12h14");
// square
export const MAX_PATH = strokeIcon("M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z");
// pin
export const PIN_PATH = strokeIcon("M12 17v5", "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z");
// app-window
export const MAIN_PATH = strokeIcon("M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M10 4v4", "M2 8h20", "M6 4v4");
// monitor-play
export const CALL_PATH = strokeIcon(
    "M10 7.75a.75.75 0 0 1 1.142-.638l3.664 2.249a.75.75 0 0 1 0 1.278l-3.664 2.25a.75.75 0 0 1-1.142-.64z",
    "M12 17v4",
    "M8 21h8",
    "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
);
export const FILE_PATH = ICONS.file;
// mic-off
export const MUTE_PATH = strokeIcon("M12 19v3", "M15 9.34V5a3 3 0 0 0-5.68-1.33", "M16.95 16.95A7 7 0 0 1 5 12v-2", "M18.89 13.23A7 7 0 0 0 19 12v-2", "m2 2 20 20", "M9 9v3a3 3 0 0 0 5.12 2.12");
// panel-left
export const SIDEBAR_PATH = strokeIcon("M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M9 3v18");
export const HASH_PATH = ICONS.hash;
// volume-2
export const SPEAKER_PATH = strokeIcon(
    "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z",
    "M16 9a5 5 0 0 1 0 6",
    "M19.364 18.364a9 9 0 0 0 0-12.728"
);
// megaphone
export const ANNOUNCE_PATH = strokeIcon(
    "M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
    "M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14",
    "M8 6v8"
);
export const CHEVRON_PATH = ICONS.chevronDown;
// headphone-off
export const DEAF_PATH = strokeIcon(
    "M21 14h-1.343",
    "M9.128 3.47A9 9 0 0 1 21 12v3.343",
    "m2 2 20 20",
    "M20.414 20.414A2 2 0 0 1 19 21h-1a2 2 0 0 1-2-2v-3",
    "M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 2.636-6.364"
);
export const DOWNLOAD_PATH = ICONS.download;
export const COPY_PATH = ICONS.copy;
// link
export const LINK_PATH = strokeIcon("M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71");
// reply
export const REPLY_PATH = strokeIcon("M20 18v-2a4 4 0 0 0-4-4H4", "m9 17-5-5 5-5");
export const EDIT_PATH = ICONS.edit;
export const TRASH_PATH = ICONS.trash;
// id-card
export const ID_PATH = strokeIcon("M16 10h2", "M16 14h2", "M6.17 15a3 3 0 0 1 5.66 0", circle(9, 11, 2), "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z");
// zoom-in
export const ZOOM_PATH = strokeIcon(circle(11, 11, 8), "m21 21-4.35-4.35", "M11 8v6", "M8 11h6");
export const LEFT_PATH = ICONS.back;
export const RIGHT_PATH = ICONS.chevron;
export const PLAY_PATH = ICONS.play;
export const USER_PATH = ICONS.user;

/** Icon in the plugin's default size – drawn by the kit (stroke icons for strokeIcon paths) */
export function Icon({ path, size = 18, className }: { path: string; size?: number; className?: string; }) {
    return <UiIcon path={path} size={size} className={className} />;
}

/**
 * Tooltip in the popout window. Discord's own tooltip would appear in the main window,
 * so this is a pure CSS recreation with Discord's colors, font and arrow.
 */
export function tip(text: string, pos: "top" | "bottom" = "top", align: "center" | "start" | "end" = "center") {
    return { "data-tip": text, "data-tip-pos": pos, "data-tip-align": align };
}

// ---------------------------------------------------------------- Media

export const CDN = "https://cdn.discordapp.com";

/** Discord flag for animated images/media (attachments, embed media, component media) */
const IS_ANIMATED = 1 << 5;
const IS_SPOILER = 1 << 3;

export function sized(url: string, w: number, h: number) {
    return `${url}${url.includes("?") ? "&" : "?"}width=${Math.round(w)}&height=${Math.round(h)}`;
}

export function fitBox(w?: number, h?: number, maxW = 400, maxH = 300) {
    if (!w || !h) return { width: undefined, height: undefined };
    const s = Math.min(1, maxW / w, maxH / h);
    return { width: Math.round(w * s), height: Math.round(h * s) };
}

/** GIFs, animated WebP/AVIF … – the media proxy turns them static when resized, so they are loaded unscaled */
export function isAnimated(media: { flags?: number; content_type?: string; url?: string; filename?: string; } | null | undefined) {
    if (!media) return false;
    return !!((media.flags ?? 0) & IS_ANIMATED)
        || media.content_type === "image/gif"
        || /\.gif($|\?)/i.test(media.filename ?? media.url ?? "");
}

export function isSpoiler(a: { flags?: number; filename?: string; spoiler?: boolean; }) {
    return !!a.spoiler || !!((a.flags ?? 0) & IS_SPOILER) || !!a.filename?.startsWith("SPOILER_");
}

/** Image that falls back to the original URL if the media proxy fails */
export function FallbackImg({ src, fallback, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fallback?: string; }) {
    const [failed, setFailed] = useState(false);
    const url = failed && fallback ? fallback : src;
    return <img {...props} src={url} loading="lazy" draggable={false} onError={() => !failed && fallback && fallback !== src && setFailed(true)} />;
}

/** Autoplaying, muted, looping video like Discord's GIF player */
export function GifVideo({ src, fallback, poster, width, height, ...props }: React.VideoHTMLAttributes<HTMLVideoElement> & { src: string; fallback?: string; }) {
    const [failed, setFailed] = useState(false);
    return (
        <video
            {...props}
            className={cl("image")}
            src={failed && fallback ? fallback : src}
            poster={poster}
            width={width}
            height={height}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            onError={() => !failed && fallback && fallback !== src && setFailed(true)}
        />
    );
}

/** Blurred until clicked, like Discord's spoiler attachments */
export function Spoiler({ children }: { children: React.ReactNode; }) {
    const [shown, setShown] = useState(false);
    if (shown) return <>{children}</>;
    return (
        <div className={cl("spoiler")} onClickCapture={e => { e.stopPropagation(); e.preventDefault(); setShown(true); }}>
            <div className={cl("spoiler-content")}>{children}</div>
            <span className={cl("spoiler-label")}>SPOILER</span>
        </div>
    );
}

// ---------------------------------------------------------------- Markdown

export function Markdown({ content, channelId, messageId }: { content: string; channelId: string; messageId: string; }) {
    const nodes = useMemo(() => {
        try {
            return Parser.parse(content, true, { channelId, messageId, allowLinks: true, allowHeading: true, allowList: true, allowEmojiLinks: true, viewingChannelId: channelId });
        } catch (e) {
            log.error("Couldn't render markdown", e);
            return content;
        }
    }, [content, channelId, messageId]);

    return <ErrorBoundary noop fallback={() => <span>{content}</span>}>{nodes}</ErrorBoundary>;
}

// ---------------------------------------------------------------- Users

export function userAvatar(id: string, author?: any, size = 80) {
    const user = UserStore.getUser(id);
    if (user && !author?.bot) return IconUtils.getUserAvatarURL(user, false, size) as string;
    if (author?.avatar) return `${CDN}/avatars/${id}/${author.avatar}.webp?size=${size}`;
    return IconUtils.getDefaultAvatarURL(id, author?.discriminator) as string;
}

export function displayName(id: string, guildId: string | null) {
    const u: any = UserStore.getUser(id);
    return (guildId && GuildMemberStore.getNick(guildId, id)) || u?.globalName || u?.username || "Someone";
}

// ---------------------------------------------------------------- Popout window

/** Prepares a popout document (theme classes, Vencord styles) and keeps its title up to date */
export function usePopoutDocument(rootRef: React.RefObject<HTMLElement | null>, title: string) {
    useLayoutEffect(() => {
        const doc = rootRef.current?.ownerDocument;
        if (!doc || doc === document) return;
        doc.documentElement.className = document.documentElement.className;
        doc.body.classList.add(...Array.from(document.body.classList));
        if (!doc.querySelector("vencord-root")) doc.documentElement.appendChild(vencordRootNode.cloneNode(true));
    }, []);

    useEffect(() => {
        const doc = rootRef.current?.ownerDocument;
        if (doc) doc.title = title;
    }, [title]);
}
