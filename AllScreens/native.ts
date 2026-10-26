/*
 * AllScreens – runs in the Electron main process
 * Discord's screen share captures exactly one monitor. To stream all of them we put every monitor side by side into
 * one hidden window (Chromium's own desktop capture, one <video> per monitor) and let Discord stream that window.
 * The window sits just outside the desktop, so it never shows up on a monitor (and never films itself).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow, desktopCapturer, IpcMainInvokeEvent, screen, session } from "electron";
import { promises as fs } from "fs";
import { join } from "path";

export interface Options {
    fps: number;
    maxWidth: number;
    layout: Layout;
}

export interface Prepared {
    /** Window source id for Discord ("window:<hwnd>:0") */
    id: string;
    screens: number;
    width: number;
    height: number;
}

interface Tile {
    sourceId: string;
    /** Place in the picture, as shares of its width/height (0..1) */
    x: number;
    y: number;
    w: number;
    h: number;
}

export type Layout = "grid" | "row";

const PARTITION = "vencord-allscreens";
/** H264 encoders stop at 4096 px, Discord's own resolutions at 2160 p */
const MAX_WIDTH = 3840, MAX_HEIGHT = 2160;

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>All Screens</title>
<style>
html, body { margin: 0; width: 100%; height: 100%; background: #000; overflow: hidden; cursor: none; }
#tiles { position: relative; width: 100%; height: 100%; }
video { position: absolute; display: block; object-fit: contain; }
</style></head>
<body><div id="tiles"></div>
<script>
let streams = [];
window.startCapture = async (tiles, fps) => {
    window.stopCapture();
    const box = document.getElementById("tiles");
    for (const tile of tiles) {
        const video = document.createElement("video");
        video.muted = true;
        Object.assign(video.style, { left: tile.x * 100 + "%", top: tile.y * 100 + "%", width: tile.w * 100 + "%", height: tile.h * 100 + "%" });
        box.appendChild(video);
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: tile.sourceId, maxFrameRate: fps, minFrameRate: 1 } }
        });
        streams.push(stream);
        video.srcObject = stream;
        await video.play();
    }
};
window.stopCapture = () => {
    for (const s of streams) for (const t of s.getTracks()) t.stop();
    streams = [];
    document.getElementById("tiles").replaceChildren();
};
</script></body></html>`;

let win: BrowserWindow | null = null;
/** Layout the window was made for – a new one is needed when monitors or settings change */
let layoutKey = "";
let tiles: Tile[] = [];
let capturing = false;
let pagePath: string | null = null;

const alive = () => win && !win.isDestroyed() ? win : null;

async function writePage() {
    if (pagePath) return pagePath;
    const path = join(app.getPath("temp"), "vencord-allscreens.html");
    await fs.writeFile(path, PAGE, "utf8");
    return pagePath = path;
}

function setupSession() {
    const ses = session.fromPartition(PARTITION);
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media"));
    ses.setPermissionCheckHandler((_wc, permission) => permission === "media");
    return ses;
}

/** All monitors left to right (top to bottom when stacked) with their capture source */
async function screens() {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    return screen.getAllDisplays()
        .map(display => ({ display, source: sources.find(s => s.display_id === String(display.id)) }))
        .filter((s): s is { display: Electron.Display; source: Electron.DesktopCapturerSource; } => s.source != null)
        .sort((a, b) => a.display.bounds.x - b.display.bounds.x || a.display.bounds.y - b.display.bounds.y);
}

type Size = { w: number; h: number; };
type Rect = { x: number; y: number; w: number; h: number; };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** All monitors in one row, same height – very wide, so Discord shrinks it a lot */
function rowLayout(sizes: Size[], maxWidth: number) {
    const tallest = Math.max(...sizes.map(s => s.h));
    const widths = sizes.map(s => s.w * tallest / s.h);
    const total = widths.reduce((a, b) => a + b, 0);
    const scale = Math.min(1, MAX_HEIGHT / tallest, maxWidth / total);
    let x = 0;
    const rects: Rect[] = widths.map(w => {
        const r = { x: x / total, y: 0, w: w / total, h: 1 };
        x += w;
        return r;
    });
    return { width: even(total * scale), height: even(tallest * scale), rects };
}

/**
 * Monitors in a grid of equal cells (3 → 2 + 1, 4 → 2 × 2, …), picked so each monitor gets as many pixels as possible
 * inside a 16:9 picture – the shape Discord's stream resolutions have, so nothing is wasted there.
 */
function gridLayout(sizes: Size[], maxWidth: number) {
    const n = sizes.length;
    const cellAspect = Math.max(...sizes.map(s => s.w / s.h));
    const boxW = maxWidth, boxH = Math.min(MAX_HEIGHT, maxWidth * 9 / 16);
    // No cell bigger than the biggest monitor
    const nativeW = Math.max(...sizes.map(s => s.w));

    let best = { cols: n, rows: 1, cellW: 0 };
    for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const cellW = Math.min(boxW / cols, boxH * cellAspect / rows, nativeW);
        if (cellW > best.cellW + 0.5) best = { cols, rows, cellW };
    }

    const { cols, rows } = best;
    const width = even(best.cellW * cols), height = even(best.cellW / cellAspect * rows);
    const rects = sizes.map((_, i) => {
        const row = Math.floor(i / cols);
        // A shorter last row is centered
        const inRow = row === rows - 1 ? n - row * cols : cols;
        const col = i - row * cols + (cols - inRow) / 2;
        return { x: col / cols, y: row / rows, w: 1 / cols, h: 1 / rows };
    });
    return { width, height, rects };
}

export async function prepare(_: IpcMainInvokeEvent, options: Options): Promise<Prepared | null> {
    const list = await screens();
    if (list.length < 2) {
        if (!capturing) close();
        return null;
    }

    const sizes = list.map(({ display }) => ({
        w: Math.round(display.bounds.width * display.scaleFactor),
        h: Math.round(display.bounds.height * display.scaleFactor)
    }));
    const maxWidth = Math.min(MAX_WIDTH, options.maxWidth > 0 ? options.maxWidth : MAX_WIDTH);
    const { width, height, rects } = options.layout === "row" ? rowLayout(sizes, maxWidth) : gridLayout(sizes, maxWidth);

    const nextTiles = list.map(({ source }, i) => ({ sourceId: source.id, ...rects[i] }));
    const key = JSON.stringify({ nextTiles, width, height, fps: options.fps });

    // Never swap the window under a running stream – Discord holds on to its handle
    if (alive() && (key === layoutKey || capturing)) return { id: win!.getMediaSourceId(), screens: tiles.length, width, height };

    close();
    tiles = nextTiles;
    layoutKey = key;

    // Just right of the rightmost monitor, sized in that monitor's pixels
    const right = Math.max(...list.map(({ display }) => display.bounds.x + display.bounds.width));
    const top = Math.min(...list.map(({ display }) => display.bounds.y));
    const near = screen.getDisplayNearestPoint({ x: right, y: top });
    const sf = near.scaleFactor || 1;

    const w = new BrowserWindow({
        show: false,
        frame: false,
        thickFrame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        enableLargerThanScreen: true,
        backgroundColor: "#000000",
        title: "All Screens",
        x: right + 200,
        y: top,
        width: Math.ceil(width / sf),
        height: Math.ceil(height / sf),
        webPreferences: {
            session: setupSession(),
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false
        }
    });
    win = w;
    w.setIgnoreMouseEvents(true);
    w.on("closed", () => {
        if (win === w) {
            win = null;
            capturing = false;
            layoutKey = "";
        }
    });

    await w.loadFile(await writePage());
    if (w.isDestroyed()) return null;
    w.setBounds({ x: right + 200, y: top, width: Math.ceil(width / sf), height: Math.ceil(height / sf) });
    w.showInactive();
    // Off screen, Chromium would treat the page as hidden and stop painting – a "capturer" keeps it drawing
    try {
        (w.webContents as any).incrementCapturerCount?.(undefined, false, true);
    } catch { }

    // Windows may refuse windows bigger than the desktop – report what we really got (the page adapts to it)
    const [cw, ch] = w.getContentSize();
    return { id: w.getMediaSourceId(), screens: tiles.length, width: Math.round(cw * sf), height: Math.round(ch * sf) };
}

/** Starts filming the monitors (once the stream really uses the window) */
export async function start(_: IpcMainInvokeEvent, fps: number): Promise<string | null> {
    const w = alive();
    if (!w) return "The All Screens window is gone - pick the source again";
    if (capturing) return null;
    capturing = true;
    try {
        await w.webContents.executeJavaScript(`window.startCapture(${JSON.stringify(tiles)}, ${Number(fps) || 60})`);
        return null;
    } catch (e) {
        capturing = false;
        return String((e as Error)?.message ?? e);
    }
}

export function isOpen(_?: IpcMainInvokeEvent) {
    return alive() != null;
}

export function isCapturing(_?: IpcMainInvokeEvent) {
    return alive() != null && capturing;
}

function close() {
    const w = alive();
    win = null;
    capturing = false;
    layoutKey = "";
    if (w) w.destroy();
}

export function stop(_: IpcMainInvokeEvent) {
    close();
}
