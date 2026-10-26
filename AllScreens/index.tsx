/*
 * AllScreens – Vencord Userplugin
 * Adds "All screens" to Discord's screen share picker: every monitor side by side in one stream. Discord's native
 * screen share films exactly one monitor, so native.ts puts all monitors into one hidden window and Discord streams
 * that window (with the system sound, like a normal screen).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { MediaEngineStore } from "@webpack/common";

import { notify } from "../_ui";
import { SettingsPanel } from "./ui";

const logger = new Logger("AllScreens");
const Native = VencordNative.pluginHelpers.AllScreens as PluginNative<typeof import("./native")>;

export const settings = definePluginSettings({
    panel: {
        type: OptionType.COMPONENT,
        component: () => <SettingsPanel />
    },
    fps: {
        type: OptionType.NUMBER,
        description: "Frames per second each monitor is filmed with",
        default: 60,
        hidden: true
    },
    maxWidth: {
        type: OptionType.NUMBER,
        description: "Widest picture (max. 3840)",
        default: 3840,
        hidden: true
    },
    layout: {
        type: OptionType.STRING,
        description: "\"grid\" (sharper) or \"row\" (all side by side)",
        default: "grid",
        hidden: true
    }
});

interface ScreenPreview {
    id: string;
    url: string;
    name: string;
}

const ID_PREFIX = "screen-allscreens:";

/** Picker id of the All Screens window ("screen-allscreens:<hwnd>"), null while there is none */
let current: string | null = null;
/** Size of the last All Screens picture, for the settings */
export let lastSize: string | null = null;
let preparedAt = 0;
let lastUsed = 0;
let watch: ReturnType<typeof setInterval> | null = null;

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
});

/** Discord's thumbnails of the single monitors, arranged like the stream (roughly) */
async function preview(list: ScreenPreview[]) {
    const images = await Promise.all(list.filter(s => s.url?.startsWith("data:image")).map(s => loadImage(s.url)));
    if (!images.length) return list[0]?.url ?? "";
    const n = images.length;
    const cols = settings.store.layout === "row" ? n : Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cellH = Math.max(...images.map(i => i.height));
    const cellW = Math.max(...images.map(i => i.width * cellH / i.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cellW * cols);
    canvas.height = cellH * rows;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    images.forEach((img, i) => {
        const row = Math.floor(i / cols);
        const inRow = row === rows - 1 ? n - row * cols : cols;
        const col = i - row * cols + (cols - inRow) / 2;
        const w = img.width * cellH / img.height;
        ctx.drawImage(img, col * cellW + (cellW - w) / 2, row * cellH, w, cellH);
    });
    return canvas.toDataURL("image/jpeg", 0.85);
}

function startWatch() {
    if (watch) return;
    watch = setInterval(async () => {
        const live = MediaEngineStore.getGoLiveSource?.()?.desktopSource?.id;
        if (current && live === current) {
            lastUsed = Date.now();
            return;
        }
        const capturing = await Native.isCapturing();
        // Stream over (or another source picked), or the picker closed without choosing All Screens
        if (capturing ? Date.now() - lastUsed > 6000 : Date.now() - preparedAt > 120_000) stop();
    }, 3000);
}

function stop() {
    if (watch) clearInterval(watch);
    watch = null;
    current = null;
    Native.stop().catch(() => { });
}

export default definePlugin({
    name: "AllScreens",
    description: "Stream all your monitors at once - adds \"All screens\" to the screen share picker",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Media", "Voice"],
    settings,

    patches: [
        {
            // Native screen list for the Go Live picker
            find: 'name:"Screen "+(',
            replacement: {
                match: /(\i)\((\i\.map\(\((\i),(\i)\)=>\(\{\.\.\.\3,name:"Screen "\+\(\4\+1\)\}\)\))\)/,
                replace: "$self.withAllScreens($2).then($1)"
            }
        },
        {
            // Our "screen-allscreens:<hwnd>" id becomes the real window id right before it goes to the native capturer
            find: "capturing desktop (type:",
            replacement: {
                match: /(let\[\i,\i\]=null!=(\i)\?)\2\.split\(":"\)/g,
                replace: '$1$self.realId($2).split(":")'
            }
        },
        {
            // Sound of the stream: like a screen (whole system), not the window's own process (Discord)
            find: '"prepicked"===',
            replacement: {
                match: /getPidFromDesktopSource\((\i)\)\{/,
                replace: "$&if($self.isAllScreens($1))return 1;"
            }
        }
    ],

    async withAllScreens(list: ScreenPreview[]): Promise<ScreenPreview[]> {
        try {
            const { fps, maxWidth, layout } = settings.store;
            const prepared = await Native.prepare({ fps, maxWidth, layout: layout === "row" ? "row" : "grid" });
            if (!prepared) return list;
            lastSize = `${prepared.width} × ${prepared.height}`;
            // The picker's "Entire Screen" tab only shows ids starting with "screen"
            current = `${ID_PREFIX}${prepared.id.split(":")[1]}`;
            preparedAt = Date.now();
            startWatch();
            return [...list, { id: current, name: `All screens (${prepared.screens})`, url: await preview(list) }];
        } catch (e) {
            logger.error("Could not prepare All Screens", e);
            return list;
        }
    },

    realId(id: string) {
        return id.startsWith(ID_PREFIX) ? `window:${id.slice(ID_PREFIX.length)}:0` : id;
    },

    /** Called by Discord when a source is picked – starts filming if it's ours */
    isAllScreens(id: string | null | undefined) {
        if (!id || id !== current) return false;
        lastUsed = Date.now();
        Native.start(settings.store.fps).then(error => {
            if (!error) return;
            logger.error("Could not start", error);
            notify({ title: "All Screens", body: `Could not film the monitors: ${error}`, kind: "error", app: "AllScreens" });
        });
        return true;
    },

    stop
});
