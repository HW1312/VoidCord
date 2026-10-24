/*
 * VoiceLength – rewrites the length of an Ogg Opus file
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Players read the length of an Ogg file from the granule position (sample count) of its LAST page.
 * - "display": only that number changes – the sound stays as it is and ends early
 * - "silence" / "loop": the file really gets that long – silence after the recording, or the recording again and
 *   again. Opus can store 120 ms of silence in 2 bytes, so hours fit; a looped voice needs far more room. Whatever
 *   doesn't fit into the upload limit is only shown (the last page still says the full length).
 */

export type FillMode = "display" | "silence" | "loop";

/** Discord's upload limit without Nitro, with room for nothing else */
export const MAX_BYTES = 10_000_000;

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let r = i << 24;
        for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
        t[i] = r >>> 0;
    }
    return t;
})();

function crc(bytes: Uint8Array) {
    let c = 0;
    for (let i = 0; i < bytes.length; i++) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
    return c;
}

const isPage = (b: Uint8Array, i: number) => b[i] === 0x4f && b[i + 1] === 0x67 && b[i + 2] === 0x67 && b[i + 3] === 0x53; // "OggS"

/** Opus always counts in 48 kHz samples; the first samples ("pre-skip") don't count towards the length */
const RATE = 48000;

interface Page { start: number; size: number; granule: bigint; segments: Uint8Array; body: Uint8Array; }

function readPages(bytes: Uint8Array) {
    const pages: Page[] = [];
    let i = 0;
    while (i + 27 <= bytes.length && isPage(bytes, i)) {
        const count = bytes[i + 26];
        const segments = bytes.subarray(i + 27, i + 27 + count);
        let bodySize = 0;
        for (const s of segments) bodySize += s;
        const size = 27 + count + bodySize;
        if (i + size > bytes.length) break;
        const granule = new DataView(bytes.buffer, bytes.byteOffset + i + 6, 8).getBigInt64(0, true);
        pages.push({ start: i, size, granule, segments, body: bytes.subarray(i + 27 + count, i + size) });
        i += size;
    }
    return pages;
}

/** Samples (48 kHz) a packet decodes to, from its TOC byte */
function packetSamples(p: Uint8Array) {
    if (!p.length) return 0;
    const config = p[0] >> 3;
    const ms = config < 12 ? [10, 20, 40, 60][config & 3] : config < 16 ? [10, 20][config & 1] : [2.5, 5, 10, 20][config & 3];
    const code = p[0] & 3;
    const frames = code === 0 ? 1 : code < 3 ? 2 : (p[1] ?? 0) & 0x3f;
    return frames * ms * RATE / 1000;
}

/** Writes Ogg pages: packets in, finished bytes out */
class PageWriter {
    chunks: Uint8Array[] = [];
    size = 0;
    private packets: Uint8Array[] = [];
    private lacing = 0;
    private granule = 0n;
    private serial: number;
    private seq: number;

    constructor(serial: number, seq: number) {
        this.serial = serial;
        this.seq = seq;
    }

    add(packet: Uint8Array, granuleAfter: bigint) {
        const lacing = Math.floor(packet.length / 255) + 1;
        if (this.lacing + lacing > 255) this.flush(false);
        this.packets.push(packet);
        this.lacing += lacing;
        this.granule = granuleAfter;
    }

    /** Bytes the next flush adds (for the size budget) */
    get pending() {
        let body = 0;
        for (const p of this.packets) body += p.length;
        return 27 + this.lacing + body;
    }

    flush(last: boolean, granule = this.granule) {
        if (!this.packets.length) return;
        let body = 0;
        for (const p of this.packets) body += p.length;
        const page = new Uint8Array(27 + this.lacing + body);
        const view = new DataView(page.buffer);
        page.set([0x4f, 0x67, 0x67, 0x53, 0, last ? 4 : 0]);
        view.setBigInt64(6, granule, true);
        view.setUint32(14, this.serial, true);
        view.setUint32(18, this.seq++, true);
        page[26] = this.lacing;
        let o = 27;
        for (const p of this.packets) {
            for (let n = p.length; n >= 0; n -= 255) page[o++] = Math.min(n, 255);
        }
        for (const p of this.packets) { page.set(p, o); o += p.length; }
        view.setUint32(22, crc(page), true);
        this.chunks.push(page);
        this.size += page.length;
        this.packets = [];
        this.lacing = 0;
    }
}

/**
 * Returns a copy of the file that reports `seconds` as its length – filled as `mode` says – or null if it isn't
 * Ogg Opus. `played` is how many seconds really play.
 */
export async function withLength(file: File, seconds: number, mode: FillMode = "display"): Promise<{ file: File; played: number; } | null> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pages = readPages(bytes);
    const head = pages[0];
    if (!head || new TextDecoder().decode(head.body.subarray(0, 8)) !== "OpusHead") return null;
    const preSkip = head.body[10] | (head.body[11] << 8);
    const total = BigInt(Math.round(seconds * RATE) + preSkip);

    // Header pages (OpusHead, OpusTags) have granule 0; audio starts on the next page
    let firstAudio = pages.findIndex((p, i) => i > 0 && p.granule !== 0n);
    if (firstAudio === -1) firstAudio = pages.length;
    const headerBytes = bytes.subarray(0, pages[firstAudio]?.start ?? bytes.length);

    // Audio packets (a packet may continue over pages: lacing 255 means "goes on")
    const packets: Uint8Array[] = [];
    let parts: Uint8Array[] = [];
    for (const page of pages.slice(firstAudio)) {
        let o = 0;
        for (const s of page.segments) {
            parts.push(page.body.subarray(o, o + s));
            o += s;
            if (s < 255) {
                const size = parts.reduce((n, p) => n + p.length, 0);
                const packet = new Uint8Array(size);
                let w = 0;
                for (const p of parts) { packet.set(p, w); w += p.length; }
                packets.push(packet);
                parts = [];
            }
        }
    }
    if (!packets.length) return null;

    const serial = new DataView(bytes.buffer, bytes.byteOffset + 14, 4).getUint32(0, true);
    const out = new PageWriter(serial, firstAudio);
    const budget = MAX_BYTES - headerBytes.length;
    let granule = 0n;
    const push = (p: Uint8Array) => {
        if (out.size + out.pending + p.length + 2 > budget) return false;
        granule += BigInt(packetSamples(p));
        out.add(p, granule);
        return true;
    };

    // The recording itself
    for (const p of packets) if (!push(p)) break;

    if (mode === "silence") {
        // 120 ms of nothing: CELT 20 ms config, same mono/stereo flag, code 3 with 6 empty frames
        const silence = new Uint8Array([(31 << 3) | (packets[0][0] & 4) | 3, 6]);
        while (granule < total && push(silence));
    } else if (mode === "loop") {
        outer: while (granule < total) {
            for (const p of packets) if (granule >= total || !push(p)) break outer;
        }
    }

    // The last page claims the full length – players trust it; anything past the real data is just shown
    out.flush(true, total);
    const played = Math.max(0, Math.min(Number(granule) - preSkip, Number(total) - preSkip) / RATE);

    const result = new Uint8Array(headerBytes.length + out.size);
    result.set(headerBytes);
    let o = headerBytes.length;
    for (const c of out.chunks) { result.set(c, o); o += c.length; }
    return { file: new File([result], file.name, { type: file.type || "audio/ogg" }), played };
}
