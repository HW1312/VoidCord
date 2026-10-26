/*
 * SecretChat – Player for encrypted voice messages: play / pause, seek bar, time. The length is the recording's
 * real one, read from the decrypted file – no waveform and no length from Discord.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@api/Styles";
import { useEffect, useRef, useState } from "@webpack/common";

const cl = classNameFactory("vc-secretchat-");

const PLAY_PATH = "M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z";
const PAUSE_PATH = "M7 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm7 0h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z";

const VOLUME_PATH = "M3 10v4a1 1 0 0 0 1 1h3l3.7 3.7a.75.75 0 0 0 1.3-.53V5.83a.75.75 0 0 0-1.3-.53L7 9H4a1 1 0 0 0-1 1Zm13.5 2A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12ZM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54Z";
const VOLUME_LOW_PATH = "M5 10v4a1 1 0 0 0 1 1h3l3.7 3.7a.75.75 0 0 0 1.3-.53V5.83a.75.75 0 0 0-1.3-.53L9 9H6a1 1 0 0 0-1 1Zm13.5 2A4.5 4.5 0 0 0 16 7.97v8.05A4.47 4.47 0 0 0 18.5 12Z";
const MUTED_PATH = "M3 10v4a1 1 0 0 0 1 1h3l3.7 3.7a.75.75 0 0 0 1.3-.53V5.83a.75.75 0 0 0-1.3-.53L7 9H4a1 1 0 0 0-1 1Zm12.3-1.7a1 1 0 0 1 1.4 0L18.5 10l1.8-1.7a1 1 0 1 1 1.4 1.4L19.9 11.5l1.8 1.8a1 1 0 0 1-1.4 1.4l-1.8-1.8-1.8 1.8a1 1 0 0 1-1.4-1.4l1.8-1.8-1.8-1.8a1 1 0 0 1 0-1.4Z";

/** Shared by all voice players for this session, like Discord's own */
let lastVolume = 1;
let lastMuted = false;

function format(seconds: number) {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VoicePlayer({ src }: { src: string; }) {
    const audio = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState<number | null>(null);
    const [volume, setVolume] = useState(lastVolume);
    const [muted, setMuted] = useState(lastMuted);
    // Recordings without a length in the header report Infinity until the end is reached once
    const probing = useRef(false);

    const onMetadata = () => {
        const a = audio.current!;
        if (Number.isFinite(a.duration)) return setDuration(a.duration);
        probing.current = true;
        a.currentTime = 1e9;
    };

    const onDurationChange = () => {
        const a = audio.current!;
        if (!Number.isFinite(a.duration)) return;
        setDuration(a.duration);
        if (probing.current) {
            probing.current = false;
            a.currentTime = 0;
        }
    };

    const toggle = () => {
        const a = audio.current;
        if (!a) return;
        if (a.paused) void a.play().catch(() => setPlaying(false));
        else a.pause();
    };

    const seek = (e: React.MouseEvent<HTMLDivElement>) => {
        const a = audio.current;
        if (!a || !duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        a.currentTime = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * duration;
    };

    useEffect(() => {
        const a = audio.current;
        if (!a) return;
        a.volume = volume;
        a.muted = muted;
    }, [volume, muted]);

    const changeVolume = (v: number) => {
        setVolume(lastVolume = v);
        // Dragging the slider up unmutes, dragging it to 0 mutes
        setMuted(lastMuted = v === 0);
    };

    const toggleMute = () => {
        // Muted at 0: unmuting would stay silent, so go back to full
        if (muted && volume === 0) setVolume(lastVolume = 1);
        setMuted(lastMuted = !muted);
    };

    const silent = muted || volume === 0;
    const progress = duration ? Math.min(1, time / duration) : 0;

    return (
        <div className={cl("voice-player")}>
            <button type="button" className={cl("voice-play")} aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor"><path d={playing ? PAUSE_PATH : PLAY_PATH} /></svg>
            </button>
            <div className={cl("voice-track")} onClick={seek}>
                <div className={cl("voice-fill")} style={{ width: `${progress * 100}%` }} />
            </div>
            <span className={cl("voice-time")}>
                {playing || time > 0 ? format(time) : duration != null ? format(duration) : "–:––"}
            </span>
            <div className={cl("voice-volume")}>
                <input
                    type="range"
                    className={cl("voice-slider")}
                    min={0}
                    max={1}
                    step={0.01}
                    value={silent ? 0 : volume}
                    aria-label="Volume"
                    style={{ "--vc-secretchat-volume": `${(silent ? 0 : volume) * 100}%` } as React.CSSProperties}
                    onChange={e => changeVolume(Number(e.currentTarget.value))}
                />
                <button type="button" className={cl("voice-mute")} aria-label={silent ? "Unmute" : "Mute"} onClick={toggleMute}>
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
                        <path d={silent ? MUTED_PATH : volume < 0.5 ? VOLUME_LOW_PATH : VOLUME_PATH} />
                    </svg>
                </button>
            </div>
            <audio
                ref={audio}
                src={src}
                preload="metadata"
                onLoadedMetadata={onMetadata}
                onDurationChange={onDurationChange}
                onTimeUpdate={() => !probing.current && setTime(audio.current!.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => { setPlaying(false); setTime(0); }}
            />
        </div>
    );
}
