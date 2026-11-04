/*
 * UpdateButton – runs in the Electron main process.
 * Finds the newest release without GitHub's API (60 requests per hour without login): the normal page
 * github.com/<repo>/releases/latest redirects to …/releases/tag/<version>, so one request with the redirect
 * not followed tells the version. That page has no such limit, so it can be checked every few minutes.
 * The update itself is downloaded the same way (installRelease), so updating never needs the API either.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fetchBuffer } from "@main/utils/http";
import { IpcMainInvokeEvent } from "electron";
import { copyFile, rename, rm, stat, writeFile } from "fs/promises";
import { request } from "https";
import { join } from "path";

/** Same repo as REPO in build.mjs */
const REPO_URL = "https://github.com/HW1312/VoidCord";
const URL_LATEST = `${REPO_URL}/releases/latest`;

/** The release assets build.mjs uploads – the files Vencord runs from (this code is bundled into patcher.js, so __dirname is their folder) */
const FILES = ["patcher.js", "preload.js", "renderer.js", "renderer.css"];

/**
 * Installs a release without GitHub's API: the files come from the normal download links
 * (github.com/<repo>/releases/download/<tag>/<file>), which have no 60-per-hour limit like Vencord's own updater.
 * All files are downloaded first, so a failed download changes nothing. They are used from the next start on.
 */
export async function installRelease(_: IpcMainInvokeEvent, tag: string) {
    if (typeof tag !== "string" || !/^[0-9a-f]{7,40}$/.test(tag)) throw new Error("Invalid version");
    // Timeout per file (covers the body too), so a stalled download fails instead of "Downloading …" forever
    const files = await Promise.all(FILES.map(async name =>
        [name, await fetchBuffer(`${REPO_URL}/releases/download/${tag}/${name}`, {
            headers: { "User-Agent": "VoidCord-Updater" },
            signal: AbortSignal.timeout(name === "renderer.js" ? 180_000 : 60_000)
        })] as const
    ));
    for (const [name, data] of files) {
        if (!data.length) throw new Error(`Download of ${name} is empty`);
    }
    // Never write over the running files directly: if Discord quits halfway or the antivirus blocks one file,
    // a cut-off patcher.js would stop Discord from starting at all. So: write all as .new and check them,
    // then swap them in one by one – each rename is atomic – and put the old ones back if a swap fails.
    const path = (name: string, ext = "") => join(__dirname, name + ext);
    try {
        for (const [name, data] of files) {
            await writeFile(path(name, ".new"), data);
            if ((await stat(path(name, ".new"))).size !== data.length) throw new Error(`Writing ${name} failed`);
        }
    } catch (e) {
        await Promise.all(FILES.map(n => rm(path(n, ".new"), { force: true }).catch(() => { })));
        throw e;
    }

    const swapped: string[] = [];
    try {
        for (const [name] of files) {
            await copyFile(path(name), path(name, ".bak")).catch(() => { });
            await rename(path(name, ".new"), path(name));
            swapped.push(name);
        }
    } catch (e) {
        // Back to the old version, so all four files stay from the same release
        for (const name of swapped) await rename(path(name, ".bak"), path(name)).catch(() => { });
        await Promise.all(FILES.map(n => rm(path(n, ".new"), { force: true }).catch(() => { })));
        throw e;
    }
    await Promise.all(FILES.map(n => rm(path(n, ".bak"), { force: true }).catch(() => { })));
    return true;
}

export function latestTag(_: IpcMainInvokeEvent): Promise<string | null> {
    return new Promise((resolve, reject) => {
        const req = request(URL_LATEST, { method: "HEAD", headers: { "User-Agent": "VoidCord-Updater" } }, res => {
            res.resume();
            const location = res.headers.location ?? "";
            const tag = /\/releases\/tag\/([^/?#]+)/.exec(location)?.[1];
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && tag) resolve(decodeURIComponent(tag));
            else if (res.statusCode === 404) resolve(null);
            else reject(new Error(`GitHub: HTTP ${res.statusCode}`));
        });
        req.on("error", reject);
        req.setTimeout(15_000, () => req.destroy(new Error("Update check timed out")));
        req.end();
    });
}
