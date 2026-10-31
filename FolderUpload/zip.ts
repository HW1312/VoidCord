/*
 * FolderUpload – Small zip writer (deflate through the browser's CompressionStream, no library)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Already compressed formats are stored as they are – deflating them again only costs time */
const STORED = /\.(zip|7z|rar|gz|tgz|bz2|xz|zst|jpe?g|png|gif|webp|avif|heic|mp4|mkv|mov|webm|avi|mp3|m4a|aac|ogg|opus|flac|woff2?|pdf|docx|xlsx|pptx|jar|apk)$/i;

/** Classic zip (no ZIP64) */
export const MAX_ENTRIES = 0xFFFF;
export const MAX_ZIP_BYTES = 0xFFFFFFFF;

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(data: Uint8Array) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

async function deflateRaw(data: Uint8Array) {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** MS-DOS time and date – zips can't store anything before 1980 */
function dosTime(ms: number) {
    const d = new Date(Number.isFinite(ms) ? ms : Date.now());
    if (d.getFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 };
    return {
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
        date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
}

const encoder = new TextEncoder();

export class ZipWriter {
    /** One Blob per entry, so the bytes move into Chromium's blob storage right away */
    private parts: Blob[] = [];
    private central: Uint8Array[] = [];
    private offset = 0;
    private count = 0;
    /** Bytes before compression */
    rawBytes = 0;

    addDir(name: string, mtime: number) {
        this.add(name.endsWith("/") ? name : name + "/", new Uint8Array(0), 0, 0, 0, mtime, true);
    }

    async addFile(name: string, data: Uint8Array, mtime: number) {
        const crc = crc32(data);
        let method = 0;
        let body = data;
        if (data.length > 64 && !STORED.test(name)) {
            const packed = await deflateRaw(data);
            if (packed.length < data.length) {
                method = 8;
                body = packed;
            }
        }
        this.rawBytes += data.length;
        this.add(name, body, method, crc, data.length, mtime, false);
    }

    private add(name: string, body: Uint8Array, method: number, crc: number, size: number, mtime: number, dir: boolean) {
        if (++this.count > MAX_ENTRIES) throw new Error(`More than ${MAX_ENTRIES.toLocaleString("en-US")} files – too many for a zip`);
        const nameBytes = encoder.encode(name);
        const { time, date } = dosTime(mtime);

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true); // names are UTF-8
        local.setUint16(8, method, true);
        local.setUint16(10, time, true);
        local.setUint16(12, date, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, body.length, true);
        local.setUint32(22, size, true);
        local.setUint16(26, nameBytes.length, true);
        local.setUint16(28, 0, true);

        const head = new DataView(new ArrayBuffer(46));
        head.setUint32(0, 0x02014b50, true);
        head.setUint16(4, 20, true);
        head.setUint16(6, 20, true);
        head.setUint16(8, 0x0800, true);
        head.setUint16(10, method, true);
        head.setUint16(12, time, true);
        head.setUint16(14, date, true);
        head.setUint32(16, crc, true);
        head.setUint32(20, body.length, true);
        head.setUint32(24, size, true);
        head.setUint16(28, nameBytes.length, true);
        // extra length, comment length, disk number, internal attributes stay 0
        head.setUint32(38, dir ? 0x10 : 0, true);
        head.setUint32(42, this.offset, true);

        const entry = new Uint8Array(46 + nameBytes.length);
        entry.set(new Uint8Array(head.buffer), 0);
        entry.set(nameBytes, 46);
        this.central.push(entry);

        this.parts.push(new Blob([local, nameBytes, body as BlobPart]));
        this.offset += 30 + nameBytes.length + body.length;
        if (this.offset > MAX_ZIP_BYTES) throw new Error("The zip would be larger than 4 GB");
    }

    finish(fileName: string) {
        const centralSize = this.central.reduce((n, c) => n + c.length, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, this.count, true);
        end.setUint16(10, this.count, true);
        end.setUint32(12, centralSize, true);
        end.setUint32(16, this.offset, true);
        return new File([...this.parts, ...this.central as BlobPart[], end], fileName, { type: "application/zip" });
    }
}
