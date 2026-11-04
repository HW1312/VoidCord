/*
 * MediaGallery – runs in the Electron main process
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

export interface FetchResult {
    ok: boolean;
    status: number;
    data?: Uint8Array;
    error?: string;
}

/**
 * Downloads a file (attachment/embed). In the renderer, CSP/CORS block requests to the Discord CDN,
 * so the download goes through the main process. https only.
 */
// Largest attachment Discord allows (Nitro)
const MAX_BYTES = 500 * 1024 * 1024;
const TOO_BIG = "File is larger than 500 MB";

export async function fetchBytes(_: IpcMainInvokeEvent, url: string): Promise<FetchResult> {
    try {
        if (!/^https:\/\//i.test(url)) return { ok: false, status: 0, error: "Invalid URL" };

        const res = await fetch(url, { redirect: "follow" });
        if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
        if (Number(res.headers.get("content-length") || 0) > MAX_BYTES) {
            void res.body?.cancel().catch(() => { });
            return { ok: false, status: res.status, error: TOO_BIG };
        }

        const data = new Uint8Array(await res.arrayBuffer());
        if (data.length > MAX_BYTES) return { ok: false, status: res.status, error: TOO_BIG };
        return { ok: true, status: res.status, data };
    } catch (e) {
        return { ok: false, status: 0, error: String(e) };
    }
}
