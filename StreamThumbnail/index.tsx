/*
 * StreamThumbnail – Vencord Userplugin
 * Your own picture as the preview of your Go Live stream – what others see when they hover your stream in the
 * channel list or look at it before joining. Discord normally takes a screenshot of your stream every few minutes;
 * this plugin sends your picture (with an optional caption, YouTube thumbnail style) instead. Right-click the
 * "Share Your Screen" button in the voice panel to change it quickly.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { FluxDispatcher, RestAPI } from "@webpack/common";

import { openShareMenu, SettingsPanel } from "./ui";

const logger = new Logger("StreamThumbnail");
const ApplicationStreamingStore = findStoreLazy("ApplicationStreamingStore");

/** Discord's preview size */
export const WIDTH = 512, HEIGHT = 288;
const STORE_KEY = "StreamThumbnail_image";

export const settings = definePluginSettings({
    panel: {
        type: OptionType.COMPONENT,
        component: () => <SettingsPanel />
    },
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Send your picture instead of a screenshot",
        default: true,
        hidden: true
    },
    caption: {
        type: OptionType.STRING,
        description: "Text on the picture",
        default: "",
        hidden: true
    }
});

// ---------------------------------------------------------------- Picture

/** The chosen picture (data URL, max. 1280 px wide) and the finished thumbnail (JPEG data URL, 512 × 288) */
let source: string | null = null;
let thumbnail: string | null = null;
export const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export const getSource = () => source;
export const getThumbnail = () => thumbnail;

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the picture"));
    img.src = src;
});

/** Big bold caption at the bottom, white with a black outline – wraps into at most 2 lines */
function drawCaption(ctx: CanvasRenderingContext2D, text: string) {
    let size = 46;
    const font = (s: number) => `900 ${s}px "Arial Black", Impact, "Segoe UI", sans-serif`;
    const maxWidth = WIDTH - 32;

    const wrap = () => {
        const lines: string[] = [];
        let line = "";
        for (const word of text.split(/\s+/)) {
            const next = line ? `${line} ${word}` : word;
            if (line && ctx.measureText(next).width > maxWidth) {
                lines.push(line);
                line = word;
            } else line = next;
        }
        if (line) lines.push(line);
        return lines;
    };

    let lines: string[];
    do {
        ctx.font = font(size);
        lines = wrap();
        if (lines.length <= 2 && lines.every(l => ctx.measureText(l).width <= maxWidth)) break;
        size -= 2;
    } while (size > 16);

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(4, size / 6);
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#fff";
    const lineHeight = size * 1.08;
    lines.slice(0, 2).forEach((line, i, all) => {
        const y = HEIGHT - 18 - (all.length - 1 - i) * lineHeight;
        ctx.strokeText(line, WIDTH / 2, y);
        ctx.fillText(line, WIDTH / 2, y);
    });
}

async function render() {
    if (!source) {
        thumbnail = null;
        return;
    }
    const img = await loadImage(source);
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // Fill the frame (cut off what sticks out), like Discord's preview does
    const scale = Math.max(WIDTH / img.width, HEIGHT / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
    const caption = settings.store.caption.trim();
    if (caption) drawCaption(ctx, caption);
    thumbnail = canvas.toDataURL("image/jpeg", 0.9);
}

/** Picks a new picture (null removes it), renders and – while you stream – sends it right away */
export async function setPicture(file: File | null) {
    if (file) {
        const url = URL.createObjectURL(file);
        try {
            const img = await loadImage(url);
            const scale = Math.min(1, 1280 / img.width);
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
            source = canvas.toDataURL("image/png");
        } finally {
            URL.revokeObjectURL(url);
        }
        await DataStore.set(STORE_KEY, source);
    } else {
        source = null;
        await DataStore.del(STORE_KEY);
    }
    await refresh();
}

/** Renders again (e.g. after the caption changed) and sends it while you stream */
export async function refresh() {
    await render();
    emit();
    if (isStreaming() && settings.store.enabled && thumbnail) await uploadNow().catch(e => logger.error("Upload failed", e));
}

// ---------------------------------------------------------------- Stream

function streamKey() {
    const s = ApplicationStreamingStore.getCurrentUserActiveStream?.();
    if (!s) return null;
    return s.streamType === "guild" ? `guild:${s.guildId}:${s.channelId}:${s.ownerId}` : `call:${s.channelId}:${s.ownerId}`;
}

export const isStreaming = () => streamKey() != null;

/** Sends the thumbnail now instead of waiting for Discord's next screenshot (every 5 minutes) */
export async function uploadNow() {
    const key = streamKey();
    if (!key || !thumbnail) return false;
    FluxDispatcher.dispatch({ type: "STREAM_PREVIEW_FETCH_SUCCESS", streamKey: key, previewURL: thumbnail } as any);
    await RestAPI.post({ url: `/streams/${encodeURIComponent(key)}/preview`, body: { thumbnail } });
    logger.info("Sent the thumbnail");
    return true;
}

export default definePlugin({
    name: "StreamThumbnail",
    description: "Your own picture (with a caption if you like) as the preview of your stream - what others see when they hover it",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Media", "Voice"],
    settings,

    patches: [
        {
            // The screenshot Discord sends as stream preview every few minutes
            find: "ApplicationStreamPreviewUploadManager",
            replacement: {
                match: /let (\i)=(\i\.toDataURL\("image\/jpeg"\));(?=if\(\i\.\i\.dispatch\(\{type:"STREAM_PREVIEW_FETCH_SUCCESS")/,
                replace: "let $1=$self.thumbnail($2);"
            }
        },
        {
            // "Share Your Screen" button in the voice panel: right-click opens the picture menu
            find: '"ManageStreamsMenu",',
            replacement: {
                match: /(?<=canGoLive:\i,enableActivities:\i.{0,2500}?)"aria-pressed":null!=\i,onClick:/,
                replace: "onContextMenu:$self.openShareMenu,$&"
            }
        }
    ],

    openShareMenu,

    thumbnail(screenshot: string) {
        return settings.store.enabled && thumbnail ? thumbnail : screenshot;
    },

    async start() {
        source = await DataStore.get<string>(STORE_KEY) ?? null;
        await render().catch(e => logger.error("Could not render the thumbnail", e));
        emit();
    }
});
