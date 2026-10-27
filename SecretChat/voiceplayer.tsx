/*
 * SecretChat – Player for encrypted voice messages: play / pause, seek bar, time. The length is the recording's
 * real one, read from the decrypted file – no waveform and no length from Discord.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@api/Styles";
import { useEffect, useRef, useState } from "@webpack/common";

import { Icon, ICONS } from "../_ui";
import { MUTE_ICON, PAUSE_ICON, VOLUME_ICON, VOLUME_LOW_ICON } from "./icons";

const cl = classNameFactory("vc-secretchat-");

const PLAY_PATH = ICONS.play;
const PAUSE_PATH = PAUSE_ICON;

const VOLUME_PATH = VOLUME_ICON;
const VOLUME_LOW_PATH = VOLUME_LOW_ICON;
const MUTED_PATH = MUTE_ICON;

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
                <Icon path={playing ? PAUSE_PATH : PLAY_PATH} size={16} />
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
                    <Icon path={silent ? MUTED_PATH : volume < 0.5 ? VOLUME_LOW_PATH : VOLUME_PATH} size={18} />
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
