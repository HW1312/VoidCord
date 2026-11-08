/*
 * CopyAll – runs in the Electron main process
 * Loads a picture (the page isn't allowed to fetch Discord's CDN, CORS) and puts a PNG on the clipboard.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { clipboard, IpcMainInvokeEvent, nativeImage } from "electron";

/** Only pictures from Discord and the GIF sites it shows – nothing else is fetched */
const ALLOWED = /(^|\.)(discordapp\.net|discordapp\.com|discord\.com|discord\.media|tenor\.com|giphy\.com)$/i;
const MAX_BYTES = 50 * 1024 * 1024;

export async function fetchImage(_: IpcMainInvokeEvent, url: string): Promise<Uint8Array> {
    const u = new URL(url);
    if (u.protocol !== "https:" || !ALLOWED.test(u.hostname)) throw new Error("This picture can't be copied");
    const res = await fetch(u, { redirect: "follow" });
    if (!res.ok) throw new Error(`Couldn't load the picture (${res.status})`);
    const size = Number(res.headers.get("content-length") || 0);
    if (size > MAX_BYTES) throw new Error("The picture is too big to copy");
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error("The picture is too big to copy");
    return buf;
}

/** png = PNG bytes (the page converts any format to PNG first) */
export function writeImage(_: IpcMainInvokeEvent, png: Uint8Array) {
    const img = nativeImage.createFromBuffer(Buffer.from(png));
    if (img.isEmpty()) throw new Error("Couldn't read the picture");
    clipboard.writeImage(img);
}
