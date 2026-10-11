/*
 * FakeMute – detect others who fake mute/deafen
 * A fake-muted client keeps sending voice, so we receive "speaking" events from someone whose voice state says
 * muted/deafened. Real mute/deafen stops the mic, so it never speaks. Works for any fake mute plugin, but only
 * for users in our own voice channel, and only once they actually talk.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SelectedChannelStore, UserStore, useEffect, useReducer, VoiceStateStore } from "@webpack/common";

export interface FakeFlags {
    mute: boolean;
    deaf: boolean;
}

/** Speaking events this soon after muting can still be the last packets of real speech */
const GRACE_MS = 1500;
/** SpeakingFlags.VOICE */
const SPEAKING_VOICE = 1;

const flagged = new Map<string, FakeFlags>();
const mutedSince = new Map<string, number>();
const deafSince = new Map<string, number>();
const listeners = new Set<() => void>();

function emit() {
    listeners.forEach(l => l());
}

function setFlags(userId: string, flags: FakeFlags | null) {
    const old = flagged.get(userId);
    if (flags ? old?.mute === flags.mute && old?.deaf === flags.deaf : !old) return;
    if (flags) flagged.set(userId, flags);
    else flagged.delete(userId);
    emit();
}

export function clearDetections() {
    flagged.clear();
    mutedSince.clear();
    deafSince.clear();
    emit();
}

export function onSpeaking({ userId, speakingFlags, context }: { userId: string; speakingFlags: number; context?: string; }) {
    if (context != null && context !== "default") return;
    if (!(speakingFlags & SPEAKING_VOICE) || userId === UserStore.getCurrentUser()?.id) return;

    const channelId = SelectedChannelStore.getVoiceChannelId();
    const vs = VoiceStateStore.getVoiceStateForUser(userId) as any;
    if (!channelId || vs?.channelId !== channelId) return;
    // Server mute/suppress is enforced by Discord - nothing to fake there
    if (vs.mute || vs.suppress || !(vs.selfMute || vs.selfDeaf)) return;

    const now = Date.now();
    const old = flagged.get(userId);
    const deaf = old?.deaf || (vs.selfDeaf && now - (deafSince.get(userId) ?? 0) > GRACE_MS);
    const mute = old?.mute || deaf || now - (mutedSince.get(userId) ?? 0) > GRACE_MS;
    if (mute || deaf) setFlags(userId, { mute, deaf });
}

export function onVoiceStates(voiceStates: { userId: string; channelId?: string | null; selfMute?: boolean; selfDeaf?: boolean; }[]) {
    const myId = UserStore.getCurrentUser()?.id;
    const now = Date.now();

    for (const vs of voiceStates ?? []) {
        if (vs.userId === myId) {
            // We switched or left the channel - old detections no longer apply
            if (vs.channelId !== SelectedChannelStore.getVoiceChannelId()) clearDetections();
            continue;
        }

        if (!vs.channelId) {
            mutedSince.delete(vs.userId);
            deafSince.delete(vs.userId);
            setFlags(vs.userId, null);
            continue;
        }

        const muted = !!(vs.selfMute || vs.selfDeaf);
        if (!muted) mutedSince.delete(vs.userId);
        else if (!mutedSince.has(vs.userId)) mutedSince.set(vs.userId, now);
        if (!vs.selfDeaf) deafSince.delete(vs.userId);
        else if (!deafSince.has(vs.userId)) deafSince.set(vs.userId, now);

        const old = flagged.get(vs.userId);
        if (!old) continue;
        if (!muted) setFlags(vs.userId, null);
        else if (old.deaf && !vs.selfDeaf) setFlags(vs.userId, { mute: old.mute, deaf: false });
    }
}

/** Used inside Discord's voice user icons (patched in) - re-renders when the user's detection changes */
export function useFakeFlags(userId?: string): FakeFlags | undefined {
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
        listeners.add(rerender);
        return () => void listeners.delete(rerender);
    }, []);
    return userId ? flagged.get(userId) : undefined;
}
