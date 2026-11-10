/*
 * VideoPopout – Vencord Userplugin
 * Picture-in-picture for videos, with a volume slider. The browser's own picture-in-picture window can't hold
 * one (and document picture-in-picture fails in Discord), so the video goes into one of Discord's own popout
 * windows instead, made to feel like picture-in-picture (main process, native.ts): the video's exact shape,
 * bottom right, on top of every program on every monitor. Inside: our own player (the one "Unter das OS" uses –
 * volume slider, seek, loop, fullscreen). The whole video is the drag area, only the controls take clicks.
 * Replaces Vencord's PictureInPicture (same button spot).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import windowCss from "file://window.css";

import { isPluginEnabled } from "@api/PluginManager";
import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import definePlugin, { PluginNative } from "@utils/types";
import { PopoutActions, PopoutWindowStore, Tooltip, useEffect, useRef } from "@webpack/common";

import { Icon, ICONS, notify } from "../_ui";
import { VideoPlayer } from "../SecretChat/player";

const cl = classNameFactory("vc-videopopout-");
const logger = new Logger("VideoPopout");
const Native = VencordNative.pluginHelpers.VideoPopout as PluginNative<typeof import("./native")>;

/** One window for videos – a new video replaces the one playing */
const WINDOW_KEY = "DISCORD_VC_VIDEOPOPOUT";

interface Clip {
    src: string;
    name: string;
    startAt: number;
    ratio: number;
}

function TopButton({ icon, label, onClick }: { icon: string; label: string; onClick(): void; }) {
    return (
        <Tooltip text={label}>
            {tip => (
                <button {...tip} type="button" aria-label={label} className={cl("top-btn")} onClick={onClick}>
                    <Icon path={icon} size={14} />
                </button>
            )}
        </Tooltip>
    );
}

function PopoutPlayer({ clip, windowKey }: { clip: Clip; windowKey: string; }) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const video = ref.current?.querySelector("video");
        let alive = true;
        let shaped = false;
        const apply = (ratio: number) => {
            if (!alive) return;
            void Native.shape(ratio)
                .then(found => { shaped ||= found; })
                .catch(e => logger.warn("Couldn't shape the window", e));
        };
        // Right away with the ratio from the chat, again once the video knows its real size
        const t = setTimeout(() => apply(clip.ratio), 150);
        const onMeta = () => {
            if (video?.videoWidth && video.videoHeight) apply(video.videoWidth / video.videoHeight);
        };
        video?.addEventListener("loadedmetadata", onMeta);
        // The window may need a moment to exist for the main process – keep trying for a few seconds
        let tries = 0;
        const retry = setInterval(() => {
            if (shaped || ++tries > 8) return clearInterval(retry);
            apply(video?.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : clip.ratio);
        }, 700);
        return () => {
            alive = false;
            clearTimeout(t);
            clearInterval(retry);
            video?.removeEventListener("loadedmetadata", onMeta);
        };
    }, []);

    return (
        <div ref={ref} className={cl("window")}>
            <style>{windowCss}</style>
            <VideoPlayer src={clip.src} name={clip.name} big autoPlay startAt={clip.startAt} noPip />
            <div className={cl("top")}>
                <TopButton icon={ICONS.close} label="Close" onClick={() => PopoutActions.close(windowKey)} />
            </div>
        </div>
    );
}

function popOut(button: HTMLElement) {
    // The button sits in the video's top bar – the video is in the same attachment wrapper
    const video = (button.parentNode?.parentNode as Element | null)?.querySelector("video");
    const src = video?.currentSrc || video?.src;
    if (!video || !src) {
        notify({ title: "No video found here", kind: "error", app: "VideoPopout" });
        return;
    }
    let name = "Video";
    try { name = decodeURIComponent(new URL(src, location.href).pathname.split("/").pop() || name); } catch { }
    const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    const clip: Clip = { src, name, startAt: video.currentTime || 0, ratio };
    const width = ratio >= 1 ? 560 : Math.round(560 * ratio);
    const height = Math.round(width / ratio);

    const open = () => {
        try {
            PopoutActions.open(WINDOW_KEY, k => (
                <ErrorBoundary message="Couldn't play the video.">
                    <PopoutPlayer clip={clip} windowKey={k} />
                </ErrorBoundary>
            ), { defaultWidth: width, defaultHeight: height });
            video.pause();
        } catch (e) {
            logger.error("Couldn't open the window", e);
            notify({ title: "Couldn't open the video", body: String((e as any)?.message ?? e), kind: "error", app: "VideoPopout" });
        }
    };
    // A video already playing in the window: the new one replaces it
    if (PopoutWindowStore.getWindowOpen(WINDOW_KEY)) {
        PopoutActions.close(WINDOW_KEY);
        setTimeout(open, 250);
    } else {
        open();
    }
}

const PopoutButton = ErrorBoundary.wrap(() => (
    <Tooltip text="Picture in picture (with volume)">
        {tip => (
            <div {...tip} className="vc-videopopout-button" role="button" onClick={e => popOut(e.currentTarget)}>
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
                    <path fill="currentColor" d="M21 3a1 1 0 0 1 1 1v7h-2V5H4v14h6v2H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h18zm0 10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h8zm-1 2h-6v4h6v-4z" />
                </svg>
            </div>
        )}
    </Tooltip>
), { noop: true });

export default definePlugin({
    name: "VideoPopout",
    description: "Picture in picture for videos with a volume slider – on top of everything, any monitor, exact video shape (replaces PictureInPicture)",
    about: "Click the button on a video in the chat and it plays in a small window in the video's exact shape, on top of everything – move it to any monitor. Unlike Vencord's PictureInPicture it has a volume slider, seek bar, loop and fullscreen. Drag it from anywhere on the video.",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Media", "Utility"],

    patches: [
        {
            // Video attachments: the buttons in the top bar (next to Download) – same spot as Vencord's PictureInPicture
            find: '["VIDEO","CLIP","AUDIO"]',
            replacement: {
                match: /(\[\i>0&&\i\.length>0.{0,150}?children:)(\i\.slice\(\i\))(?<=showDownload:(\i).+?isVisualMediaType:(\i).+?)/,
                replace: (_, rest, children, showDownload, isVisual) => `${rest}[${showDownload}&&${isVisual}&&$self.PopoutButton(),...${children}]`
            }
        }
    ],

    PopoutButton,

    start() {
        // Both on: only one of the two buttons would show (they patch the same spot)
        if (isPluginEnabled("PictureInPicture")) logger.warn("PictureInPicture is on too – turn it off, VideoPopout replaces it");
    },

    stop() {
        if (PopoutWindowStore.getWindowOpen(WINDOW_KEY)) PopoutActions.close(WINDOW_KEY);
    }
});
