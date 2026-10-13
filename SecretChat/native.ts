/*
 * SecretChat – runs in the Electron main process
 * Downloads encrypted attachments when the page itself isn't allowed to (CORS). Only Discord's CDN hosts and
 * Catbox (where files over the upload limit go).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, dialog, IpcMainInvokeEvent } from "electron";
import { writeFile } from "fs/promises";
import { request } from "https";
import { basename } from "path";

const HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net", "files.catbox.moe"]);
/** Encrypted files are at most the Nitro upload limit */
const MAX_BYTES = 520 * 1024 * 1024;

function get(url: string, redirects: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        let u: URL;
        try {
            u = new URL(url);
        } catch {
            return reject(new Error("Bad URL"));
        }
        if (u.protocol !== "https:" || !HOSTS.has(u.hostname)) return reject(new Error("Not a Discord or Catbox file"));

        const req = request(u, { method: "GET" }, res => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
                res.resume();
                return resolve(get(new URL(res.headers.location, u).toString(), redirects - 1));
            }
            if (status !== 200) {
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
            res.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
            res.on("error", reject);
        });
        req.on("error", reject);
        req.setTimeout(60_000, () => req.destroy(new Error("Download timed out")));
        req.end();
    });
}

export function download(_: IpcMainInvokeEvent, url: string) {
    return get(url, 3);
}

/** Save only to a path explicitly chosen by the user; false means the dialog was cancelled. */
export async function save(event: IpcMainInvokeEvent, data: Uint8Array, name: string) {
    if (!(data instanceof Uint8Array) || typeof name !== "string") throw new Error("Invalid file");
    const parent = BrowserWindow.fromWebContents(event.sender);
    if (!parent) throw new Error("Discord window is no longer available");
    const result = await dialog.showSaveDialog(parent, { defaultPath: basename(name) || "file" });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, data);
    return true;
}
