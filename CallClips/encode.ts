/*
 * CallClips – turns the recorded sound into a file.
 * Ogg Opus through WebCodecs' AudioEncoder (faster than real time, ~1 MB per minute, Discord plays it in the chat);
 * WAV if this Discord has no Opus encoder.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const RATE = 48000;

export interface Encoded {
    data: Uint8Array;
    ext: ".ogg" | ".wav";
    type: string;
}

// ---------------------------------------------------------------- Ogg

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

const FLAG_FIRST = 0x02;
const FLAG_LAST = 0x04;

/** One Ogg page holding whole packets (Opus packets are < 1.3 KB, so they never need to span pages) */
function page(serial: number, sequence: number, granule: bigint, flags: number, packets: Uint8Array[]) {
    const lacing: number[] = [];
    for (const p of packets) {
        for (let n = p.length; ; n -= 255) {
            lacing.push(Math.min(n, 255));
            if (n < 255) break;
        }
    }
    const bodySize = packets.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(27 + lacing.length + bodySize);
    const view = new DataView(out.buffer);
    out.set([0x4f, 0x67, 0x67, 0x53]); // "OggS"
    out[5] = flags;
    view.setBigInt64(6, granule, true);
    view.setUint32(14, serial, true);
    view.setUint32(18, sequence, true);
    out[26] = lacing.length;
    out.set(lacing, 27);
    let o = 27 + lacing.length;
    for (const p of packets) { out.set(p, o); o += p.length; }
    view.setUint32(22, crc(out), true);
    return out;
}

const ascii = (s: string) => new TextEncoder().encode(s);

function opusHead(channels: number, preSkip: number) {
    const b = new Uint8Array(19);
    const v = new DataView(b.buffer);
    b.set(ascii("OpusHead"));
    b[8] = 1;
    b[9] = channels;
    v.setUint16(10, preSkip, true);
    v.setUint32(12, RATE, true);
    return b;
}

function opusTags() {
    const vendor = ascii("VoidCord CallClips");
    const b = new Uint8Array(8 + 4 + vendor.length + 4);
    const v = new DataView(b.buffer);
    b.set(ascii("OpusTags"));
    v.setUint32(8, vendor.length, true);
    b.set(vendor, 12);
    return b;
}

interface Packet { data: Uint8Array; samples: number; }

/** Packets per page – about one second */
const PAGE_PACKETS = 50;

function oggOpus(packets: Packet[], channels: number, preSkip: number, frames: number) {
    const serial = (Math.random() * 0xffffffff) >>> 0;
    const pages = [page(serial, 0, 0n, FLAG_FIRST, [opusHead(channels, preSkip)]), page(serial, 1, 0n, 0, [opusTags()])];
    // The last page's position says where the sound really ends – the encoder pads the last packet
    const end = BigInt(preSkip + frames);
    let granule = 0n;
    for (let i = 0, seq = 2; i < packets.length; i += PAGE_PACKETS, seq++) {
        const group = packets.slice(i, i + PAGE_PACKETS);
        for (const p of group) granule += BigInt(p.samples);
        const last = i + PAGE_PACKETS >= packets.length;
        pages.push(page(serial, seq, last && end < granule ? end : granule, last ? FLAG_LAST : 0, group.map(p => p.data)));
    }
    const out = new Uint8Array(pages.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of pages) { out.set(p, o); o += p.length; }
    return out;
}

// ---------------------------------------------------------------- Opus (WebCodecs)

/** libopus' look-ahead at 48 kHz, used if the encoder doesn't tell */
const DEFAULT_PRE_SKIP = 312;
const CHUNK = 4800;

async function encodeOpus(channels: Float32Array[]): Promise<Uint8Array | null> {
    if (typeof AudioEncoder === "undefined") return null;
    const config: AudioEncoderConfig = { codec: "opus", sampleRate: RATE, numberOfChannels: channels.length, bitrate: 128_000 };
    try {
        if (!(await AudioEncoder.isConfigSupported(config)).supported) return null;
    } catch {
        return null;
    }

    const packets: Packet[] = [];
    let preSkip = DEFAULT_PRE_SKIP;
    let failure: unknown = null;
    const encoder = new AudioEncoder({
        output(chunk, meta) {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            packets.push({ data, samples: Math.round((chunk.duration ?? 20_000) * RATE / 1_000_000) });
            // Chromium hands an OpusHead as description: its pre-skip is the real one
            const desc = meta?.decoderConfig?.description as ArrayBuffer | ArrayBufferView | undefined;
            if (desc) {
                const bytes = ArrayBuffer.isView(desc) ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength) : new Uint8Array(desc);
                if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 8)) === "OpusHead") preSkip = bytes[10] | (bytes[11] << 8);
            }
        },
        error(e) { failure = e; }
    });
    encoder.configure(config);

    const frames = channels[0].length;
    for (let off = 0; off < frames; off += CHUNK) {
        const n = Math.min(CHUNK, frames - off);
        const planar = new Float32Array(n * channels.length);
        channels.forEach((c, i) => planar.set(c.subarray(off, off + n), i * n));
        const audio = new AudioData({ format: "f32-planar", sampleRate: RATE, numberOfFrames: n, numberOfChannels: channels.length, timestamp: Math.round(off / RATE * 1_000_000), data: planar });
        encoder.encode(audio);
        audio.close();
    }
    await encoder.flush();
    encoder.close();
    if (failure || !packets.length) return null;
    return oggOpus(packets, channels.length, preSkip, frames);
}

// ---------------------------------------------------------------- WAV

function wav(channels: Float32Array[]) {
    const frames = channels[0].length;
    const count = channels.length;
    const out = new Uint8Array(44 + frames * count * 2);
    const v = new DataView(out.buffer);
    out.set(ascii("RIFF"), 0);
    v.setUint32(4, out.length - 8, true);
    out.set(ascii("WAVEfmt "), 8);
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, count, true);
    v.setUint32(24, RATE, true);
    v.setUint32(28, RATE * count * 2, true);
    v.setUint16(32, count * 2, true);
    v.setUint16(34, 16, true);
    out.set(ascii("data"), 36);
    v.setUint32(40, frames * count * 2, true);
    let o = 44;
    for (let i = 0; i < frames; i++) {
        for (const c of channels) {
            const s = Math.max(-1, Math.min(1, c[i]));
            v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            o += 2;
        }
    }
    return out;
}

/** channels: equally long 48 kHz tracks (left, right) */
export async function encode(channels: Float32Array[]): Promise<Encoded> {
    const ogg = await encodeOpus(channels).catch(() => null);
    if (ogg) return { data: ogg, ext: ".ogg", type: "audio/ogg" };
    return { data: wav(channels), ext: ".wav", type: "audio/wav" };
}

/** Back to 48 kHz tracks (for trimming a saved clip) */
export async function decode(data: Uint8Array): Promise<Float32Array[]> {
    const ctx = new OfflineAudioContext(2, 1, RATE);
    const buffer = await ctx.decodeAudioData(data.slice().buffer);
    const out: Float32Array[] = [];
    for (let c = 0; c < 2; c++) out.push(buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)).slice());
    return out;
}
