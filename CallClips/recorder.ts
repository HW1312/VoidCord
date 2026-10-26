/*
 * CallClips – keeps the last seconds of a call in memory while you're in one.
 * Discord's call sound runs in its native voice engine, out of reach – so the recorder takes the PC's sound
 * (Chromium desktop capture: the others' voices and everything else that plays) plus your microphone. Your mic only
 * goes into the clip while Discord sends it: its own "speaking" events (they follow mute, push-to-talk and voice
 * activity) are kept as a timeline and applied when the clip is made.
 * Everything stays in two ring buffers (16-bit); older sound is overwritten. Nothing is stored before you clip.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { PluginNative } from "@utils/types";

import { RATE } from "./encode";

const Native = VencordNative.pluginHelpers.CallClips as PluginNative<typeof import("./native")>;
const logger = new Logger("CallClips");

export type MicMode = "auto" | "always" | "never";

/** Keeps Int16 samples of the last `capacity` frames */
class Ring {
    private data: Int16Array[];
    private pos = 0;
    /** Frames written since the start */
    written = 0;

    constructor(channels: number, readonly capacity: number) {
        this.data = Array.from({ length: channels }, () => new Int16Array(capacity));
    }

    write(input: Float32Array[]) {
        const n = input[0].length;
        for (let c = 0; c < this.data.length; c++) {
            const src = input[c] ?? input[0];
            const dst = this.data[c];
            let p = this.pos;
            for (let i = 0; i < n; i++) {
                const s = src[i];
                dst[p] = s >= 1 ? 32767 : s <= -1 ? -32768 : s * 32767;
                if (++p === this.capacity) p = 0;
            }
        }
        this.pos = (this.pos + n) % this.capacity;
        this.written += n;
    }

    /** The newest `frames` frames as floats */
    read(frames: number): Float32Array[] {
        frames = Math.min(frames, this.capacity, this.written);
        return this.data.map(src => {
            const out = new Float32Array(frames);
            let p = (this.pos - frames + this.capacity) % this.capacity;
            for (let i = 0; i < frames; i++) {
                out[i] = src[p] / 32768;
                if (++p === this.capacity) p = 0;
            }
            return out;
        });
    }
}

// ---------------------------------------------------------------- State

export interface RecorderState {
    running: boolean;
    /** Starting, or a problem (e.g. Windows didn't share the sound) */
    error: string;
}

export const state: RecorderState = { running: false, error: "" };
export const listeners = new Set<() => void>();
const set = (patch: Partial<RecorderState>) => {
    Object.assign(state, patch);
    listeners.forEach(l => l());
};

let ctx: AudioContext | null = null;
let streams: MediaStream[] = [];
let tap: AudioWorkletNode | ScriptProcessorNode | null = null;
let ring: Ring | null = null;
let starting: Promise<void> | null = null;
/** Frame positions where your speaking started / stopped (newest last) */
let speaking: { at: number; on: boolean; }[] = [];
let micOn = false;

/** Mic fades in this long before Discord reports speaking (the report comes late) and out after it ends */
const PRE_ROLL = 0.35 * RATE;
const RELEASE = 0.4 * RATE;
const FADE = 0.01 * RATE;
/** Extra room so a clip of the full length is always complete */
const SPARE_SECONDS = 2;

async function openSystemSound(): Promise<MediaStream> {
    const sourceId = await Native.screenSourceId();
    if (!sourceId) throw new Error("No screen found to capture the sound from");
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: "desktop" } } as any,
        // The video track is required to get the sound, it is stopped right away
        video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId, maxWidth: 16, maxHeight: 16, maxFrameRate: 1 } } as any
    });
    stream.getVideoTracks().forEach(t => t.stop());
    if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach(t => t.stop());
        throw new Error("Windows didn't share the PC sound");
    }
    return stream;
}

/*
 * Takes the samples off the audio thread. A ScriptProcessor runs on Discord's busy main thread and drops whole blocks
 * when it's late – each gap is a click in the clip. The worklet runs on the audio thread and posts blocks of 2048
 * frames; messages wait in a queue, so a busy main thread delays them but loses nothing.
 */
const TAP_SOURCE = `
class Tap extends AudioWorkletProcessor {
    constructor() { super(); this.reset(); }
    reset() { this.buf = [new Float32Array(2048), new Float32Array(2048), new Float32Array(2048)]; this.n = 0; }
    process(inputs) {
        const input = inputs[0] || [];
        const frames = input[0] ? input[0].length : 128;
        for (let c = 0; c < 3; c++) if (input[c]) this.buf[c].set(input[c], this.n);
        this.n += frames;
        if (this.n >= 2048) {
            this.port.postMessage(this.buf, this.buf.map(b => b.buffer));
            this.reset();
        }
        return true;
    }
}
registerProcessor("vc-callclips-tap", Tap);
`;

async function createTap(context: AudioContext, onBlock: (channels: Float32Array[]) => void): Promise<AudioWorkletNode | ScriptProcessorNode> {
    try {
        const url = URL.createObjectURL(new Blob([TAP_SOURCE], { type: "text/javascript" }));
        try {
            await context.audioWorklet.addModule(url);
        } finally {
            URL.revokeObjectURL(url);
        }
        const node = new AudioWorkletNode(context, "vc-callclips-tap", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 3, channelCountMode: "explicit", channelInterpretation: "discrete" });
        node.port.onmessage = e => onBlock(e.data);
        return node;
    } catch (e) {
        // Until Discord was restarted once with the plugin (blob: worklets need its content security policy entry)
        logger.warn("AudioWorklet unavailable, using a ScriptProcessor (may click when Discord is busy)", e);
        const node = context.createScriptProcessor(16384, 3, 1);
        node.onaudioprocess = e => {
            const b = e.inputBuffer;
            onBlock([b.getChannelData(0), b.getChannelData(1), b.getChannelData(2)]);
        };
        return node;
    }
}

function openMic(): Promise<MediaStream | null> {
    return navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }).catch(e => {
        logger.warn("No microphone – clips only have the call sound", e);
        return null;
    });
}

/** Starts keeping the last `seconds` of sound. Calling it again while running does nothing. */
export function start(seconds: number, withMic: boolean) {
    if (state.running || starting) return starting ?? Promise.resolve();
    starting = (async () => {
        try {
            const system = await openSystemSound();
            const mic = withMic ? await openMic() : null;
            streams = mic ? [system, mic] : [system];

            ctx = new AudioContext({ sampleRate: RATE });
            // Inputs 0/1 = PC sound left/right, 2 = mic (mono)
            const merger = ctx.createChannelMerger(3);
            const splitter = ctx.createChannelSplitter(2);
            ctx.createMediaStreamSource(system).connect(splitter);
            splitter.connect(merger, 0, 0);
            splitter.connect(merger, 1, 1);
            if (mic) {
                const mono = ctx.createGain();
                mono.channelCount = 1;
                mono.channelCountMode = "explicit";
                ctx.createMediaStreamSource(mic).connect(mono);
                mono.connect(merger, 0, 2);
            }

            ring = new Ring(3, Math.round((seconds + SPARE_SECONDS) * RATE));
            speaking = micOn ? [{ at: 0, on: true }] : [];
            tap = await createTap(ctx, channels => ring?.write(channels));
            merger.connect(tap);
            // Only pulled while connected to the output; it writes silence there
            tap.connect(ctx.destination);
            set({ running: true, error: "" });
        } catch (e: any) {
            logger.error("Could not start recording", e);
            stop();
            set({ error: String(e?.message ?? e) });
        } finally {
            starting = null;
        }
    })();
    return starting;
}

export function stop() {
    if (tap instanceof AudioWorkletNode) tap.port.onmessage = null;
    else if (tap) tap.onaudioprocess = null;
    tap?.disconnect();
    streams.forEach(s => s.getTracks().forEach(t => t.stop()));
    ctx?.close().catch(() => { });
    ctx = tap = ring = null;
    streams = [];
    speaking = [];
    if (state.running) set({ running: false });
}

/** Discord's own speaking state (SPEAKING events for your user) */
export function onSpeaking(on: boolean) {
    if (on === micOn) return;
    micOn = on;
    if (!ring) return;
    speaking.push({ at: ring.written, on });
    // Only what's still inside the buffer matters (keep the last change before it)
    const oldest = ring.written - ring.capacity;
    while (speaking.length > 1 && speaking[1].at <= oldest) speaking.shift();
}

/** 0..1 per frame: how much of the mic goes into the clip */
function micGate(start: number, frames: number, mode: MicMode) {
    const gate = new Float32Array(frames);
    if (mode === "never") return gate;
    if (mode === "always") return gate.fill(1);
    // Speaking spans, widened by pre-roll / release
    const spans: [number, number][] = [];
    let open: number | null = null;
    for (const s of speaking) {
        if (s.on && open == null) open = s.at;
        else if (!s.on && open != null) { spans.push([open, s.at]); open = null; }
    }
    if (open != null) spans.push([open, Infinity]);
    for (const [a, b] of spans) {
        const from = Math.max(0, a - PRE_ROLL - start);
        const to = Math.min(frames, b + RELEASE - start);
        for (let i = Math.floor(from); i < to; i++) {
            // Short fades so switching makes no click
            const fade = Math.min(1, (i - (a - PRE_ROLL - start)) / FADE, (b + RELEASE - start - i) / FADE);
            gate[i] = Math.max(gate[i], fade);
        }
    }
    return gate;
}

/** The last `seconds` as two 48 kHz tracks, mic mixed in. null = nothing recorded yet. */
export function take(seconds: number, mode: MicMode): Float32Array[] | null {
    if (!ring || ring.written < RATE / 2) return null;
    const [l, r, mic] = ring.read(Math.round(seconds * RATE));
    const frames = l.length;
    const gate = micGate(ring.written - frames, frames, mode);
    for (let i = 0; i < frames; i++) {
        const m = mic[i] * gate[i];
        l[i] = softClip(l[i] + m);
        r[i] = softClip(r[i] + m);
    }
    return [l, r];
}

/** Keeps loud moments from cracking when the call and your voice add up */
function softClip(x: number) {
    const a = Math.abs(x);
    return a <= 0.9 ? x : Math.sign(x) * (0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1));
}
