/*
 * FolderUpload – Reading a folder (dropped / pasted, or picked through the main process), .gitignore, zipping
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { IgnoreRule, isIgnored, parseGitignore } from "./gitignore";
import { MAX_ENTRIES, ZipWriter } from "./zip";

const Native = VencordNative.pluginHelpers.FolderUpload as PluginNative<typeof import("./native")>;

export interface FolderEntry { name: string; dir: boolean; size: number; mtime: number; }

export interface FolderSource {
    name: string;
    /** dir = path relative to the folder with "/" ("" = the folder itself) */
    list(dir: string): Promise<FolderEntry[]>;
    read(path: string): Promise<Uint8Array>;
    close?(): void;
}

/** Uncompressed – everything stays in memory while zipping */
export const MAX_TOTAL = 2 * 1024 * 1024 * 1024;

const JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;
const SECRET = /^\.env(\..+)?$|.\.env$|^id_(rsa|dsa|ecdsa|ed25519)$|\.(pem|key|p12|pfx)$/i;
/** Example files that are meant to be shared */
const TEMPLATE = /\.(example|sample|template|dist|defaults?)$/i;

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const isSecret = (path: string) => SECRET.test(baseName(path)) && !TEMPLATE.test(baseName(path));

// ---------------------------------------------------------------- Sources

function readAllEntries(reader: FileSystemDirectoryReader) {
    return new Promise<FileSystemEntry[]>((resolve, reject) => {
        const all: FileSystemEntry[] = [];
        // readEntries hands them out in batches until it returns an empty one
        const next = () => reader.readEntries(batch => {
            if (!batch.length) return resolve(all);
            all.push(...batch);
            next();
        }, reject);
        next();
    });
}

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

/** A folder from a drop or paste (the entry stays readable after the event) */
export function entrySource(root: FileSystemDirectoryEntry): FolderSource {
    const dirs = new Map<string, FileSystemDirectoryEntry>([["", root]]);
    const files = new Map<string, File>();
    return {
        name: root.name,
        async list(dir) {
            const parent = dirs.get(dir);
            if (!parent) throw new Error(`Unknown folder ${dir}`);
            const out: FolderEntry[] = [];
            for (const e of await readAllEntries(parent.createReader())) {
                const path = dir ? `${dir}/${e.name}` : e.name;
                if (e.isDirectory) {
                    dirs.set(path, e as FileSystemDirectoryEntry);
                    out.push({ name: e.name, dir: true, size: 0, mtime: Date.now() });
                } else if (e.isFile) {
                    const f = await fileOf(e as FileSystemFileEntry);
                    files.set(path, f);
                    out.push({ name: e.name, dir: false, size: f.size, mtime: f.lastModified });
                }
            }
            return out;
        },
        async read(path) {
            const f = files.get(path);
            if (!f) throw new Error(`Unknown file ${path}`);
            return new Uint8Array(await f.arrayBuffer());
        }
    };
}

/** Folder picker (main process). null = cancelled */
export async function pickFolderSource(): Promise<FolderSource | null> {
    // Missing when Discord's main process still runs an older Vencord build (only Ctrl+R after installing)
    if (!Native?.pickFolder) throw new Error("Fully quit Discord (also from the tray) and start it again");
    const picked = await Native.pickFolder();
    if (!picked) return null;
    return {
        name: picked.name,
        list: dir => Native.listDir(picked.token, dir),
        read: path => Native.readFolderFile(picked.token, path),
        close: () => void Native.closeFolder(picked.token).catch(() => { })
    };
}

// ---------------------------------------------------------------- Scan

export interface ScannedFile { path: string; size: number; mtime: number; }

export interface Scan {
    files: ScannedFile[];
    /** Every folder that goes into the zip (also empty ones) */
    dirs: { path: string; mtime: number; }[];
    /** Files and folders left out by .gitignore (a left out folder counts once) */
    ignored: number;
    usedGitignore: boolean;
}

export async function scanFolder(src: FolderSource, useGitignore: boolean): Promise<Scan> {
    const scan: Scan = { files: [], dirs: [], ignored: 0, usedGitignore: false };
    let total = 0;

    const walk = async (dir: string, inherited: IgnoreRule[]) => {
        const entries = (await src.list(dir)).sort((a, b) => a.name.localeCompare(b.name));
        let rules = inherited;

        const ignoreFile = useGitignore && entries.find(e => !e.dir && e.name === ".gitignore");
        if (ignoreFile) {
            const text = new TextDecoder().decode(await src.read(dir ? `${dir}/.gitignore` : ".gitignore"));
            rules = [...inherited, ...parseGitignore(text, dir)];
            scan.usedGitignore = true;
        }

        for (const e of entries) {
            const path = dir ? `${dir}/${e.name}` : e.name;
            if (JUNK.test(e.name)) continue;
            // Git never shares its own folder
            if ((e.dir && e.name === ".git") || isIgnored(path, e.dir, rules)) {
                scan.ignored++;
                continue;
            }
            if (scan.files.length + scan.dirs.length >= MAX_ENTRIES) {
                throw new Error(`More than ${MAX_ENTRIES.toLocaleString("en-US")} files – too many for a zip`);
            }
            if (e.dir) {
                scan.dirs.push({ path, mtime: e.mtime });
                await walk(path, rules);
            } else {
                total += e.size;
                if (total > MAX_TOTAL) throw new Error("Larger than 2 GB – too big to zip in Discord");
                scan.files.push({ path, size: e.size, mtime: e.mtime });
            }
        }
    };

    await walk("", []);
    return scan;
}

// ---------------------------------------------------------------- Zip

/** Everything goes into a top folder with the folder's name, like Windows' "Compressed folder" */
export async function zipFolder(src: FolderSource, scan: Scan, files: ScannedFile[], onProgress?: (done: number, total: number) => void) {
    const zip = new ZipWriter();
    const top = src.name;
    const total = files.reduce((n, f) => n + f.size, 0);
    let done = 0;

    zip.addDir(top, Date.now());
    for (const d of scan.dirs) zip.addDir(`${top}/${d.path}`, d.mtime);
    for (const f of files) {
        await zip.addFile(`${top}/${f.path}`, await src.read(f.path), f.mtime);
        done += f.size;
        onProgress?.(done, total);
    }
    return { file: zip.finish(`${safeName(top)}.zip`), rawBytes: zip.rawBytes };
}

function safeName(name: string) {
    return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "folder";
}
