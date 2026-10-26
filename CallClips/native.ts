/*
 * CallClips – runs in the Electron main process.
 * - Clips are plain files in Downloads\Call Clips. The renderer only passes file names, never paths.
 * - screenSourceId(): a screen id for Chromium's desktop capture, which also delivers the system sound (Windows).
 * - setHotkey(): a global shortcut (works while a game has focus) that calls the plugin in the Discord window.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CspPolicies } from "@main/csp";
import { app, desktopCapturer, globalShortcut, IpcMainInvokeEvent, shell } from "electron";
import { promises as fs } from "fs";
import { basename, extname, join } from "path";

// The recorder's AudioWorklet is loaded from a blob: URL – worklets count as scripts. Vencord already allows inline
// scripts and eval, so this adds no new risk. Applies from the next Discord start.
CspPolicies["blob:"] = [...new Set([...(CspPolicies["blob:"] ?? []), "script-src"])];

const DIR = join(app.getPath("downloads"), "Call Clips");
const EXTENSIONS = new Set([".ogg", ".wav"]);
/** Windows forbids these in file names */
const BAD_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;
const MAX_BYTES = 200 * 1024 * 1024;

async function ensureDir() {
    await fs.mkdir(DIR, { recursive: true });
    return DIR;
}

/** A clip's path from its file name – only plain names of clips inside the folder */
function clipPath(file: unknown) {
    if (typeof file !== "string" || basename(file) !== file || !EXTENSIONS.has(extname(file).toLowerCase())) throw new Error("Invalid clip name");
    return join(DIR, file);
}

function cleanName(name: unknown) {
    const n = String(name ?? "").replace(BAD_CHARS, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 100);
    return n || "Clip";
}

async function exists(path: string) {
    return fs.access(path).then(() => true, () => false);
}

/** "name.ogg", or "name (2).ogg" … if taken */
async function freeName(name: string, ext: string) {
    let file = `${name}${ext}`;
    for (let i = 2; await exists(join(DIR, file)); i++) file = `${name} (${i})${ext}`;
    return file;
}

export interface ClipFile {
    file: string;
    size: number;
    /** Last change (ms) */
    modified: number;
}

export async function listClips(_: IpcMainInvokeEvent): Promise<ClipFile[]> {
    await ensureDir();
    const out: ClipFile[] = [];
    for (const file of await fs.readdir(DIR)) {
        if (!EXTENSIONS.has(extname(file).toLowerCase())) continue;
        const stat = await fs.stat(join(DIR, file)).catch(() => null);
        if (stat?.isFile()) out.push({ file, size: stat.size, modified: stat.mtimeMs });
    }
    return out.sort((a, b) => b.modified - a.modified);
}

export async function saveClip(_: IpcMainInvokeEvent, name: string, ext: string, data: Uint8Array) {
    if (ext !== ".ogg" && ext !== ".wav") throw new Error("Invalid clip type");
    if (!(data instanceof Uint8Array) || data.length > MAX_BYTES) throw new Error("Invalid clip data");
    await ensureDir();
    const file = await freeName(cleanName(name), ext);
    await fs.writeFile(join(DIR, file), data);
    return file;
}

/** Replaces the content (after trimming) – the untrimmed one goes to the recycle bin, so it can be undone */
export async function overwriteClip(_: IpcMainInvokeEvent, file: string, data: Uint8Array) {
    if (!(data instanceof Uint8Array) || data.length > MAX_BYTES) throw new Error("Invalid clip data");
    const path = clipPath(file);
    if (!await exists(path)) throw new Error("The clip is gone");
    await shell.trashItem(path);
    await fs.writeFile(path, data);
}

export async function readClip(_: IpcMainInvokeEvent, file: string) {
    return new Uint8Array(await fs.readFile(clipPath(file)));
}

/** Returns the new file name */
export async function renameClip(_: IpcMainInvokeEvent, file: string, name: string) {
    const from = clipPath(file);
    const ext = extname(file);
    const wanted = cleanName(name);
    if (`${wanted}${ext}` === file) return file;
    const next = await freeName(wanted, ext);
    await fs.rename(from, join(DIR, next));
    return next;
}

/** Into the recycle bin, so a wrong click can be undone */
export async function deleteClip(_: IpcMainInvokeEvent, file: string) {
    await shell.trashItem(clipPath(file));
}

export function showClip(_: IpcMainInvokeEvent, file: string) {
    shell.showItemInFolder(clipPath(file));
}

export async function openFolder(_: IpcMainInvokeEvent) {
    await shell.openPath(await ensureDir());
}

export async function screenSourceId(_: IpcMainInvokeEvent) {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    return sources[0]?.id ?? null;
}

// ---------------------------------------------------------------- Global shortcut

let hotkey: string | null = null;

const CALL = "Vencord.Plugins.plugins.CallClips?.onHotkey?.()";

/** true = registered. Fails when another app already uses the shortcut. */
export function setHotkey(e: IpcMainInvokeEvent, accelerator: string) {
    clearHotkey(e);
    if (!accelerator) return true;
    const { sender } = e;
    try {
        const ok = globalShortcut.register(accelerator, () => {
            if (!sender.isDestroyed()) sender.executeJavaScript(CALL).catch(() => { });
        });
        if (ok) hotkey = accelerator;
        return ok;
    } catch {
        return false;
    }
}

export function clearHotkey(_: IpcMainInvokeEvent) {
    if (hotkey) globalShortcut.unregister(hotkey);
    hotkey = null;
}
