/*
 * FakeRobux – runs in the Electron main process
 * Reads Roblox's public web API (no login, no cookies) and its thumbnails. Done here because Discord's page
 * blocks both (CORS / CSP). Pictures come back as data URLs, so they show without restarting Discord.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CspPolicies, ImageSrc } from "@main/csp";
import { IpcMainInvokeEvent } from "electron";

// Lets later Discord starts load Roblox pictures directly as well
CspPolicies["*.rbxcdn.com"] = ImageSrc;

const MAX_IMAGE = 4 * 1024 * 1024;
const MAX_TEXT = 40 * 1024 * 1024;

/** Only https and only the given domain, so the renderer can't make us fetch anything else */
function checkUrl(url: string, domain: string) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !(u.hostname === domain || u.hostname.endsWith("." + domain))) throw new Error("URL not allowed");
    return u;
}

export async function api(_: IpcMainInvokeEvent, url: string, body?: unknown) {
    const u = checkUrl(url, "roblox.com");
    const res = await fetch(u, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Accept": "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
    });
    if (res.status === 429) throw new Error("Roblox is limiting requests right now – try again in a minute.");
    if (!res.ok) throw new Error(`Roblox: HTTP ${res.status}`);
    return await res.json();
}

/** Text file from Roblox's CDN – the 3D avatar export (JSON manifest, OBJ model, MTL materials) */
export async function text(_: IpcMainInvokeEvent, url: string) {
    const u = checkUrl(url, "rbxcdn.com");
    const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`3D model: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_TEXT) throw new Error("3D model too large");
    return buf.toString("utf8");
}

export async function image(_: IpcMainInvokeEvent, url: string) {
    const u = checkUrl(url, "rbxcdn.com");
    const res = await fetch(u, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Image: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE) throw new Error("Image too large");
    const type = (res.headers.get("content-type") || "image/png").toLowerCase().split(";")[0];
    return `data:${type.startsWith("image/") ? type : "image/png"};base64,${buf.toString("base64")}`;
}
