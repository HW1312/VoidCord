/*
 * SecretChat – Keyring and per-chat state, saved in Vencord's DataStore (IndexedDB, not in the settings file)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { ChannelStore, showToast, useEffect, useReducer } from "@webpack/common";

import { fromB64, keyFingerprint, keyIdOf, safetyCode, toB64 } from "./crypto";

export interface KeyRecord {
    /** keyIdOf(key), sent with every message */
    id: string;
    name: string;
    /** private: made by a handshake, only you and partnerId have it. group: anyone with the code / password */
    kind: "private" | "group";
    partnerId?: string;
    source?: "handshake" | "random" | "password" | "code" | "room" | "vault";
    /** Handshake keys: made with the hybrid ECDH + ML-KEM exchange (false = older ECDH-only handshake) */
    quantumSafe?: boolean;
    key: string;
    safety: string;
    created: number;
}

export interface PendingHandshake {
    to: string;
    channelId: string;
    privateJwk: JsonWebKey;
    kemSeed?: string;
    /** Our request message – deleted once it's answered */
    messageId?: string;
    created: number;
}

/** A chat (group DM, DM or server channel) that is always encrypted and listed in the SecretChat area */
export interface Room {
    channelId: string;
    keyId: string;
    name: string;
    created: number;
}

/** Someone made a chat you are in a secret room, and you don't have its key yet */
export interface Invite {
    channelId: string;
    keyId: string;
    /** Full key fingerprint from the announce (rooms announced by older versions have none) */
    fp?: string;
    from: string;
    created: number;
}

/** Our join request in a room, until a member answers with the key */
export interface PendingJoin {
    channelId: string;
    keyId: string;
    /** The key we get must have this fingerprint (if the announce had one) */
    fp?: string;
    privateJwk: JsonWebKey;
    kemSeed?: string;
    /** Our join message – deleted once we got the key */
    messageId?: string;
    created: number;
}

/**
 * A server only you can read: its key lives only in the key file (USB stick) and – while unlocked – in memory.
 * Saved here is only what isn't secret: which server, the key's id / fingerprint, and the channels left plain.
 */
export interface Vault {
    guildId: string;
    keyId: string;
    /** keyFingerprint() – checks that an opened key file holds exactly this key */
    fp: string;
    name: string;
    created: number;
    /** Channels that are NOT encrypted (everything else is, also channels created later) */
    plain: string[];
}

interface State {
    keys: KeyRecord[];
    /** guild id → vault */
    vaults: Record<string, Vault>;
    /** channel id → key id used for sending. Missing = encryption off */
    channels: Record<string, string>;
    /** channel id → key id that was on last, for the right-click toggle */
    lastUsed: Record<string, string>;
    /** handshake id → our half, until the other side answers */
    pending: Record<string, PendingHandshake>;
    /** handshake ids that were accepted / ignored / completed */
    handled: string[];
    /** handshake ids that were declined (by us or the other side) */
    declined: string[];
    /** channel id → room */
    rooms: Record<string, Room>;
    /** channel id → invite */
    invites: Record<string, Invite>;
    /** join id → our half of the key exchange */
    joins: Record<string, PendingJoin>;
    /** channel ids removed from the area – not added again automatically */
    left: string[];
    /** "channel id:key id" of dismissed invites – not shown again */
    dismissed: string[];
}

const STORE_KEY = "SecretChat_state";

const empty = (): State => ({ keys: [], vaults: {}, channels: {}, lastUsed: {}, pending: {}, handled: [], declined: [], rooms: {}, invites: {}, joins: {}, left: [], dismissed: [] });

export const state: State = empty();
const keyBytes = new Map<string, Uint8Array>();
let loaded = false;

const listeners = new Set<() => void>();

export function emit() {
    for (const l of listeners) l();
}

export function save() {
    emit();
    return DataStore.set(STORE_KEY, state);
}

export async function loadState() {
    const saved = await DataStore.get<Partial<State>>(STORE_KEY);
    Object.assign(state, empty(), saved ?? {});
    keyBytes.clear();
    for (const k of state.keys) keyBytes.set(k.id, fromB64(k.key));
    loaded = true;
    emit();
}

export const isLoaded = () => loaded;

/** Re-renders the component whenever keys or chat settings change */
export function useStore() {
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
        listeners.add(rerender);
        return () => void listeners.delete(rerender);
    }, []);
    return state;
}

export function onChange(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

// ---------------------------------------------------------------- Keys

export const getKey = (id: string) => state.keys.find(k => k.id === id) ?? vaultRecord(Object.values(state.vaults).find(v => v.keyId === id));
export const getKeyBytes = (id: string) => keyBytes.get(id);

// ---------------------------------------------------------------- Vaults (key only in memory while unlocked)

/** Stand-in key record for a vault: never in state.keys, so the key is never written to disk */
const vaultRecords = new Map<string, KeyRecord>();
function vaultRecord(v: Vault | undefined): KeyRecord | undefined {
    if (!v) return undefined;
    let r = vaultRecords.get(v.keyId);
    if (!r) vaultRecords.set(v.keyId, r = { id: v.keyId, name: v.name, kind: "group", source: "vault", key: "", safety: "", created: v.created });
    r.name = v.name;
    return r;
}

export const getVault = (guildId: string | undefined | null) => guildId ? state.vaults[guildId] : undefined;
export const isVaultUnlocked = (v: Vault) => keyBytes.has(v.keyId);

/** The vault that encrypts this channel (threads follow their parent channel), if any */
export function vaultOfChannel(channelId: string) {
    const ch: any = ChannelStore.getChannel(channelId);
    const vault = getVault(ch?.guild_id);
    if (!vault) return undefined;
    if (vault.plain.includes(channelId) || (ch.parent_id && vault.plain.includes(ch.parent_id))) return undefined;
    return vault;
}

/** Puts the opened key into memory only – checked against the fingerprint saved with the vault */
export async function unlockVault(guildId: string, key: Uint8Array) {
    const vault = getVault(guildId);
    if (!vault) throw new Error("This server isn't a vault");
    if (await keyIdOf(key) !== vault.keyId || await keyFingerprint(key) !== vault.fp) throw new Error("This key file belongs to another vault");
    keyBytes.set(vault.keyId, key);
    emit();
}

/** Forgets the key (memory only) – the server's messages are random characters again */
export function lockVault(guildId: string) {
    const vault = getVault(guildId);
    if (!vault) return;
    keyBytes.get(vault.keyId)?.fill(0);
    keyBytes.delete(vault.keyId);
    emit();
}

/** Locks every vault (plugin stopped) */
export function lockAllVaults() {
    for (const v of Object.values(state.vaults)) lockVault(v.guildId);
}

export async function addVault(vault: Omit<Vault, "plain">, key: Uint8Array) {
    state.vaults[vault.guildId] = { ...vault, plain: getVault(vault.guildId)?.plain ?? [] };
    await save();
    await unlockVault(vault.guildId, key);
}

/** Stops treating the server as a vault. Its messages stay encrypted – the key file can make it a vault again. */
export async function removeVault(guildId: string) {
    lockVault(guildId);
    delete state.vaults[guildId];
    await save();
}

export async function setVaultChannel(guildId: string, channelId: string, encrypted: boolean) {
    const vault = getVault(guildId);
    if (!vault) return;
    const plain = vault.plain.filter(id => id !== channelId);
    if (!encrypted) plain.push(channelId);
    vault.plain = plain;
    await save();
}

function uniqueName(name: string) {
    const taken = new Set(state.keys.map(k => k.name));
    if (!taken.has(name)) return name;
    let i = 2;
    while (taken.has(`${name} (${i})`)) i++;
    return `${name} (${i})`;
}

/** Adds a key. Returns the existing record (and isNew false) if the same key is already in the keyring. */
export async function addKey(key: Uint8Array, info: Pick<KeyRecord, "name" | "kind" | "partnerId" | "source" | "quantumSafe">) {
    const id = await keyIdOf(key);
    const existing = getKey(id);
    if (existing) return { record: existing, isNew: false };

    const record: KeyRecord = {
        ...info,
        id,
        name: uniqueName(info.name.trim() || "Key"),
        key: toB64(key),
        safety: await safetyCode(key),
        created: Date.now()
    };
    state.keys.push(record);
    keyBytes.set(id, key);
    await save();
    return { record, isNew: true };
}

/** Old messages stay readable only while their key exists – so deleting is always the user's explicit choice */
export async function deleteKey(id: string) {
    state.keys = state.keys.filter(k => k.id !== id);
    keyBytes.delete(id);
    for (const [ch, k] of Object.entries(state.channels)) if (k === id) delete state.channels[ch];
    for (const [ch, k] of Object.entries(state.lastUsed)) if (k === id) delete state.lastUsed[ch];
    for (const [ch, r] of Object.entries(state.rooms)) if (r.keyId === id) delete state.rooms[ch];
    await save();
}

export async function renameKey(id: string, name: string) {
    const k = getKey(id);
    if (!k || !name.trim()) return;
    k.name = name.trim();
    await save();
}

// ---------------------------------------------------------------- Chats

/** A secret room's key always wins: a room must never fall back to plain text or switch to a key the others don't have */
export const channelKey = (channelId: string) => {
    // A vault channel always has its vault key – also while locked (then its bytes are missing and
    // sending is refused instead of going out readable)
    const vault = vaultOfChannel(channelId);
    if (vault) return vaultRecord(vault);
    // The key chosen for the chat wins (a chat can also be listed as a room with an older key – forcing that one
    // made both sides use different keys). The room key only steps in when no key is chosen: a room never goes plain.
    const chosen = state.channels[channelId];
    if (chosen && keyBytes.has(chosen)) return getKey(chosen);
    const room = state.rooms[channelId];
    return room && keyBytes.has(room.keyId) ? getKey(room.keyId) : undefined;
};

/** The room key of this chat, if it is a secret room whose key we have */
const roomKeyId = (channelId: string) => {
    const room = state.rooms[channelId];
    return room && keyBytes.has(room.keyId) ? room.keyId : null;
};

function refuseRoomChange(channelId: string, keyId: string | null) {
    if (vaultOfChannel(channelId)) {
        showToast({ text: "This channel belongs to your vault – choose its channels with right-click on the server → Vault", variant: "critical" });
        return true;
    }
    // Rooms can't be turned off (that would send plain text) – switching to another key stays allowed
    if (keyId !== null || !roomKeyId(channelId)) return false;
    showToast({ text: "Secret rooms always stay encrypted – leave the room first to turn encryption off", variant: "critical" });
    return true;
}

/** Drops our open requests to this user (e.g. the request message was deleted) */
export async function cancelPending(userId: string) {
    for (const [hsid, p] of Object.entries(state.pending)) if (p.to === userId) delete state.pending[hsid];
    await save();
}

export async function setChannelKey(channelId: string, keyId: string | null) {
    if (refuseRoomChange(channelId, keyId)) return;
    if (keyId) {
        state.channels[channelId] = keyId;
        state.lastUsed[channelId] = keyId;
    } else {
        delete state.channels[channelId];
    }
    await save();
}

/** Right-click on the chat bar button: off ↔ the key used last (or the only key) */
export async function toggleChannel(channelId: string) {
    const vault = vaultOfChannel(channelId);
    if (vault) return refuseRoomChange(channelId, null), vault.keyId;
    const roomKey = roomKeyId(channelId);
    if (roomKey) return refuseRoomChange(channelId, null), channelKey(channelId)?.id ?? roomKey;
    if (state.channels[channelId]) return setChannelKey(channelId, null), null;
    const id = state.lastUsed[channelId] && keyBytes.has(state.lastUsed[channelId])
        ? state.lastUsed[channelId]
        : state.keys.length === 1 ? state.keys[0].id : null;
    if (id) await setChannelKey(channelId, id);
    return id;
}

// ---------------------------------------------------------------- Rooms

export async function addRoom(channelId: string, keyId: string, name: string) {
    state.rooms[channelId] = { channelId, keyId, name: name.trim().slice(0, 64) || "Secret room", created: Date.now() };
    state.channels[channelId] = keyId;
    state.lastUsed[channelId] = keyId;
    delete state.invites[channelId];
    state.left = state.left.filter(id => id !== channelId);
    for (const [jid, j] of Object.entries(state.joins)) if (j.channelId === channelId) delete state.joins[jid];
    await save();
}

/** Only removes it from the area – the chat stays encrypted until it's turned off with the lock */
export async function removeRoom(channelId: string) {
    delete state.rooms[channelId];
    if (!state.left.includes(channelId)) state.left.push(channelId);
    await save();
}

/** The chat is gone (deleted, or you were removed): forget the room – and its key if nothing else uses it */
export async function dropRoom(channelId: string, dropKey: boolean) {
    const room = state.rooms[channelId];
    delete state.rooms[channelId];
    delete state.channels[channelId];
    delete state.lastUsed[channelId];
    delete state.invites[channelId];
    for (const [jid, j] of Object.entries(state.joins)) if (j.channelId === channelId) delete state.joins[jid];
    const keyId = room?.keyId;
    if (dropKey && keyId && !Object.values(state.channels).includes(keyId) && !Object.values(state.rooms).some(r => r.keyId === keyId)) {
        state.keys = state.keys.filter(k => k.id !== keyId);
        keyBytes.delete(keyId);
    }
    await save();
}

export async function renameRoom(channelId: string, name: string) {
    const r = state.rooms[channelId];
    if (!r || !name.trim()) return;
    r.name = name.trim().slice(0, 64);
    await save();
}

export async function addInvite(invite: Invite) {
    state.invites[invite.channelId] = invite;
    await save();
}

export const isDismissed = (channelId: string, keyId: string) => state.dismissed.includes(`${channelId}:${keyId}`);

export async function dismissInvite(channelId: string) {
    const invite = state.invites[channelId];
    if (invite && !isDismissed(channelId, invite.keyId)) state.dismissed.push(`${channelId}:${invite.keyId}`);
    delete state.invites[channelId];
    for (const [jid, j] of Object.entries(state.joins)) if (j.channelId === channelId) delete state.joins[jid];
    await save();
}

// ---------------------------------------------------------------- Invite codes for group keys

/** "sckey1.<name>.<key>" – contains the key itself, so only send it in an encrypted chat or in person */
const CODE_RE = /sckey1\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;

export function inviteCode(record: KeyRecord) {
    return `sckey1.${toB64(new TextEncoder().encode(record.name))}.${record.key}`;
}

export function parseInviteCode(text: string) {
    const m = CODE_RE.exec(text);
    if (!m) return null;
    try {
        const key = fromB64(m[2]);
        if (key.length !== 32) return null;
        const name = new TextDecoder().decode(fromB64(m[1])).slice(0, 64);
        return { name, key };
    } catch {
        return null;
    }
}

export const containsInviteCode = (text: string) => CODE_RE.test(text);
