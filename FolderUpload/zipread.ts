/*
 * FolderUpload – Reading a zip that lives on Discord's CDN without downloading all of it: the end record and the
 * file list come from the last bytes, a single file is fetched only when it's opened (HTTP ranges, main process).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

const Native = VencordNative.pluginHelpers.FolderUpload as PluginNative<typeof import("./native")>;

export interface ZipItem {
    path: string;
    dir: boolean;
    size: number;
    csize: number;
    method: number;
    offset: number;
    /** Password protected */
    encrypted: boolean;
    mtime: number;
}

export interface ZipIndex { items: ZipItem[]; total: number; }

export interface RemoteZip {
    /** end is inclusive */
    range(start: number, end: number): Promise<Uint8Array>;
    tail(n: number): Promise<{ data: Uint8Array; total: number; }>;
}

const MB = 1024 * 1024;
/** The file list itself – more than this is a zip with hundreds of thousands of files */
const MAX_LIST = 64 * MB;

export function remoteZip(url: string): RemoteZip {
    // Missing when Discord's main process still runs an older Vencord build (only Ctrl+R after installing)
    const native = () => {
        if (!Native?.fetchRange) throw new Error("Fully quit Discord (also from the tray) and start it again");
        return Native;
    };
    /** The server ignored the Range header and sent everything – keep it */
    let whole: Uint8Array | null = null;

    const keep = (r: { data: Uint8Array; start: number; total: number; }) => {
        if (r.start === 0 && r.data.length === r.total) whole = r.data;
        return r;
    };

    return {
        async range(start, end) {
            if (whole) return whole.subarray(start, end + 1);
            const r = keep(await native().fetchRange(url, start, end));
            const off = start - r.start;
            return r.data.subarray(off, off + end - start + 1);
        },
        async tail(n) {
            if (whole) return { data: whole.subarray(Math.max(0, whole.length - n)), total: whole.length };
            const r = keep(await native().fetchRange(url, -n));
            return { data: r.data.subarray(Math.max(0, r.data.length - n)), total: r.total };
        }
    };
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 0x100000000;

// Old zips (Windows' "Compressed folder" too) store names in the DOS code page, not UTF-8
const CP437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const utf8 = new TextDecoder("utf-8", { fatal: true });

function decodeName(bytes: Uint8Array, flags: number) {
    if (flags & 0x0800) return new TextDecoder().decode(bytes);
    try {
        return utf8.decode(bytes);
    } catch {
        return Array.from(bytes, b => b < 0x80 ? String.fromCharCode(b) : CP437[b - 0x80]).join("");
    }
}

function dosToMs(time: number, date: number) {
    return new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2).getTime();
}

export async function readIndex(zip: RemoteZip): Promise<ZipIndex> {
    // End record (22 bytes) + up to 64 KB comment, and the ZIP64 locator (20 bytes) in front of it
    const { data: tail, total } = await zip.tail(22 + 0xFFFF + 20);
    const tailStart = total - tail.length;

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
        if (u32(tail, i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error("This isn't a zip file (or it's damaged)");

    let count = u16(tail, eocd + 10);
    let listSize = u32(tail, eocd + 12);
    let listStart = u32(tail, eocd + 16);
    if (count === 0xFFFF || listSize === 0xFFFFFFFF || listStart === 0xFFFFFFFF) {
        const loc = eocd - 20;
        if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new Error("Damaged ZIP64 file");
        const at = u64(tail, loc + 8);
        const rec = at >= tailStart ? tail.subarray(at - tailStart) : await zip.range(at, at + 55);
        if (u32(rec, 0) !== 0x06064b50) throw new Error("Damaged ZIP64 file");
        count = u64(rec, 32);
        listSize = u64(rec, 40);
        listStart = u64(rec, 48);
    }
    if (listSize > MAX_LIST) throw new Error("Too many files to show");

    const list = listStart >= tailStart
        ? tail.subarray(listStart - tailStart, listStart - tailStart + listSize)
        : await zip.range(listStart, listStart + listSize - 1);

    const items: ZipItem[] = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= list.length; i++) {
        if (u32(list, p) !== 0x02014b50) break;
        const flags = u16(list, p + 8);
        const method = u16(list, p + 10);
        let csize = u32(list, p + 20);
        let size = u32(list, p + 24);
        const nameLen = u16(list, p + 28);
        const extraLen = u16(list, p + 30);
        const commentLen = u16(list, p + 32);
        const attrs = u32(list, p + 38);
        let offset = u32(list, p + 42);

        // ZIP64 sizes / offset sit in extra field 0x0001, only the ones that are 0xFFFFFFFF above
        const extraEnd = p + 46 + nameLen + extraLen;
        for (let e = p + 46 + nameLen; e + 4 <= extraEnd;) {
            const id = u16(list, e);
            const len = u16(list, e + 2);
            if (id === 1) {
                let q = e + 4;
                if (size === 0xFFFFFFFF) { size = u64(list, q); q += 8; }
                if (csize === 0xFFFFFFFF) { csize = u64(list, q); q += 8; }
                if (offset === 0xFFFFFFFF) offset = u64(list, q);
            }
            e += 4 + len;
        }

        const path = decodeName(list.subarray(p + 46, p + 46 + nameLen), flags).replace(/\\/g, "/");
        items.push({
            path: path.replace(/\/+$/, ""),
            dir: path.endsWith("/") || (attrs & 0x10) !== 0,
            size, csize, method, offset,
            encrypted: (flags & 1) !== 0,
            mtime: dosToMs(u16(list, p + 12), u16(list, p + 14))
        });
        p = extraEnd + commentLen;
    }
    return { items: items.filter(i => i.path && !i.path.split("/").includes("..")), total };
}

const METHODS: Record<number, string> = { 9: "Deflate64", 12: "BZIP2", 14: "LZMA", 93: "Zstandard", 95: "XZ", 98: "PPMd" };

async function inflateRaw(data: Uint8Array) {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One file out of the zip (only that file is downloaded) */
export async function readItem(zip: RemoteZip, item: ZipItem, max: number) {
    if (item.encrypted) throw new Error("This file is password protected");
    if (item.method !== 0 && item.method !== 8) throw new Error(`Packed with ${METHODS[item.method] ?? `method ${item.method}`} – download the zip to open it`);
    if (item.size > max) throw new Error("Too large to open here – download the zip");

    // Local header (30 bytes + name + extra – its extra field can differ from the list's) and the data in one go
    const guess = 30 + 1024;
    let head = await zip.range(item.offset, item.offset + guess + item.csize - 1);
    if (u32(head, 0) !== 0x04034b50) throw new Error("The zip is damaged");
    const start = 30 + u16(head, 26) + u16(head, 28);
    if (start + item.csize > head.length) head = await zip.range(item.offset, item.offset + start + item.csize - 1);
    const raw = head.subarray(start, start + item.csize);
    return item.method === 0 ? raw : inflateRaw(raw);
}
