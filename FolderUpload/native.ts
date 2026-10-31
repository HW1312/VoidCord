/*
 * FolderUpload – runs in the Electron main process
 * Folder picker for the "Upload a Folder" menu item. The page can only list and read inside folders the user picked.
 * Zip preview: byte ranges of zips on Discord's CDN / Catbox (the page isn't allowed to fetch them, CORS).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID } from "crypto";
import { BrowserWindow, dialog, IpcMainInvokeEvent, OpenDialogOptions } from "electron";
import { lstat, readdir, readFile, writeFile } from "fs/promises";
import { request } from "https";
import { basename, join, resolve, sep } from "path";

/** token → absolute folder the user picked */
const roots = new Map<string, string>();

export async function pickFolder(e: IpcMainInvokeEvent) {
    const options: OpenDialogOptions = { title: "Upload a folder", properties: ["openDirectory"] };
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const root = res.filePaths[0];
    if (res.canceled || !root) return null;

    const token = randomUUID();
    roots.set(token, root);
    return { token, name: basename(root) || "folder" };
}

function inside(token: string, rel: string) {
    const root = roots.get(token);
    if (!root) throw new Error("The folder isn't open anymore");
    const full = resolve(root, rel);
    const prefix = root.endsWith(sep) ? root : root + sep;
    if (full !== resolve(root) && !full.startsWith(prefix)) throw new Error("Path outside the picked folder");
    return full;
}

/** Files and folders only – links are skipped (no loops, nothing outside the folder) */
export async function listDir(_: IpcMainInvokeEvent, token: string, rel: string) {
    const dir = inside(token, rel);
    const entries = await readdir(dir, { withFileTypes: true });
    const out = await Promise.all(entries.filter(d => d.isFile() || d.isDirectory()).map(async d => {
        const st = await lstat(join(dir, d.name)).catch(() => null);
        return { name: d.name, dir: d.isDirectory(), size: d.isFile() ? st?.size ?? 0 : 0, mtime: st?.mtimeMs ?? Date.now() };
    }));
    return out;
}

export async function readFolderFile(_: IpcMainInvokeEvent, token: string, rel: string) {
    return new Uint8Array(await readFile(inside(token, rel)));
}

export function closeFolder(_: IpcMainInvokeEvent, token: string) {
    roots.delete(token);
}

// ---------------------------------------------------------------- Zip preview

const HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net", "files.catbox.moe"]);
/** One request never returns more than this (a whole file when the server ignores Range) */
const MAX_BYTES = 600 * 1024 * 1024;

interface RangeResult { data: Uint8Array; total: number; start: number; }

function getRange(url: string, range: string, redirects: number): Promise<RangeResult> {
    return new Promise((resolvePromise, reject) => {
        let u: URL;
        try {
            u = new URL(url);
        } catch {
            return reject(new Error("Bad URL"));
        }
        if (u.protocol !== "https:" || !HOSTS.has(u.hostname)) return reject(new Error("Not a Discord or Catbox file"));

        const req = request(u, { method: "GET", headers: { Range: range } }, res => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
                res.resume();
                return resolvePromise(getRange(new URL(res.headers.location, u).toString(), range, redirects - 1));
            }
            if (status !== 200 && status !== 206) {
                res.resume();
                return reject(new Error(`Download failed (${status})`));
            }
            const chunks: Buffer[] = [];
            let size = 0;
            res.on("data", (c: Buffer) => {
                size += c.length;
                if (size > MAX_BYTES) {
                    req.destroy();
                    reject(new Error("File too large"));
                    return;
                }
                chunks.push(c);
            });
            res.on("end", () => {
                const data = new Uint8Array(Buffer.concat(chunks));
                // 206: "bytes 100-199/1234" – 200: the server sent the whole file
                const m = /bytes (\d+)-\d+\/(\d+)/.exec(String(res.headers["content-range"] ?? ""));
                resolvePromise(status === 206 && m
                    ? { data, start: Number(m[1]), total: Number(m[2]) }
                    : { data, start: 0, total: data.length });
            });
            res.on("error", reject);
        });
        req.on("error", reject);
        req.setTimeout(60_000, () => req.destroy(new Error("Download timed out")));
        req.end();
    });
}

/** start < 0 = the last -start bytes. end is inclusive. */
export function fetchRange(_: IpcMainInvokeEvent, url: string, start: number, end?: number) {
    const range = start < 0 ? `bytes=${start}` : `bytes=${start}-${end ?? ""}`;
    return getRange(url, range, 3);
}

/** Save one file from a zip – only to a path the user picks */
export async function saveFile(e: IpcMainInvokeEvent, data: Uint8Array, name: string) {
    if (!(data instanceof Uint8Array) || typeof name !== "string") throw new Error("Invalid file");
    const win = BrowserWindow.fromWebContents(e.sender);
    const options = { defaultPath: basename(name) || "file" };
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (res.canceled || !res.filePath) return false;
    await writeFile(res.filePath, data);
    return true;
}
