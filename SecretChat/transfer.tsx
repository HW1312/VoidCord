/*
 * SecretChat – Moves your keys to your phone (or another PC), so messages encrypted there can be read on it too.
 * They travel through Discord into a group only you are in, encrypted with a one-time code shown on the sending
 * device. You type the code on the other device; without it the messages are useless. They are deleted once
 * the keys arrived.
 *
 * part: "🔑 SC1T.<transfer id>.<part>.<parts>.<salt>.<data>" – the data of all parts joined is nonce 12 | sealed
 * The sealed payload is the deflated JSON of the keys, which chats use which key, and the secret rooms.
 * Open handshakes and joins stay on the device that started them.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@api/Styles";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import { ChannelStore, NavigationRouter, RestAPI, UserStore, useState } from "@webpack/common";

import { Button, Icon, ICONS, notify, openAlert, State, TextField } from "../_ui";
import { ageOf, MessageRef, refOf } from "./cleanup";
import { decodeText, encodeText, fromB64, keyFromTransferCode, open, randomBytes, seal, toB64, toHex } from "./crypto";
import { PHONE_ICON } from "./icons";
import { retryLocked } from "./messages";
import { settings } from "./settings";
import { addKey, emit, getKeyBytes, isLoaded, KeyRecord, Room, save, state, useStore } from "./store";

const logger = new Logger("SecretChat");
const cl = classNameFactory("vc-secretchat-");

const TRANSFER_RE = /^🔑 SC1T\.([0-9a-f]{16})\.(\d{1,2})\.(\d{1,2})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{1,1900})$/;
const PART_SIZE = 1900;
const MAX_PARTS = 30;
/** Transfers nobody imported are deleted when they show up after this long */
const MAX_AGE = 24 * 60 * 60 * 1000;
/** No 0 / O / 1 / I – easy to type on a phone. 32 characters, so every random byte maps evenly. */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;

interface Payload {
    v: 1;
    keys: Pick<KeyRecord, "key" | "name" | "kind" | "partnerId" | "source" | "quantumSafe">[];
    channels: Record<string, string>;
    rooms: Omit<Room, "created">[];
}

interface Transfer {
    parts: number;
    salt: string;
    data: string[];
    messages: MessageRef[];
}

const transfers = new Map<string, Transfer>();
/** message id → its transfer, for the card (shown under the first part only) */
export const transferMessages = new Map<string, { tid: string; part: number; }>();
/** Transfers sent from this device → their code, shown on the card until the keys arrived */
const sentHere = new Map<string, string>();

const myId = () => UserStore.getCurrentUser()?.id;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const aadFor = (tid: string, authorId: string) => encodeText(`SC1T|${tid}|${authorId}`);

const newCode = () => Array.from(randomBytes(CODE_LENGTH), b => CODE_CHARS[b % 32]).join("");
const formatCode = (code: string) => code.replace(/(.{4})(?=.)/g, "$1-");
const normalizeCode = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, "");

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
    return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());
}

// ---------------------------------------------------------------- Messages

/** Takes transfer parts out of the chat (only the card shows them). False if it isn't one. */
export function processTransferMessage(m: any) {
    const t = TRANSFER_RE.exec(m.content);
    if (!t) return false;
    m.content = "";
    // Only your own account can hand you keys. The optimistic copy while sending has a temporary id.
    if (m.author?.id !== myId() || m.state === "SENDING") return true;

    const [, tid, partText, partsText, salt, data] = t;
    const part = Number(partText), parts = Number(partsText);
    if (parts < 1 || parts > MAX_PARTS || part >= parts) return true;
    let tr = transfers.get(tid);
    if (!tr) transfers.set(tid, tr = { parts, salt, data: [], messages: [] });
    if (tr.parts !== parts || tr.salt !== salt) return true;
    tr.data[part] = data;
    if (!tr.messages.some(r => r.id === m.id)) tr.messages.push(refOf(m));
    transferMessages.set(m.id, { tid, part });
    if (ageOf(m) > MAX_AGE) setTimeout(() => deleteTransfer(tid), 0);
    setTimeout(emit, 0);
    return true;
}

/** Deletes all parts – the keys arrived, or the transfer was cancelled / is too old */
async function deleteTransfer(tid: string) {
    const tr = transfers.get(tid);
    transfers.delete(tid);
    sentHere.delete(tid);
    emit();
    for (const ref of tr?.messages ?? []) {
        try {
            await RestAPI.del({ url: `/channels/${ref.channelId}/messages/${ref.id}` });
        } catch (e) {
            logger.warn("Could not delete a key transfer message", e);
        }
        await sleep(300);
    }
}

// ---------------------------------------------------------------- Sending

/** The group only you are in – made once, then reused */
async function transferChannel() {
    const saved = settings.store.transferChannel;
    if (saved && ChannelStore.getChannel(saved)) return saved;
    const { body: { id } } = await RestAPI.post({ url: "/users/@me/channels", body: { recipients: [] } }) as { body: { id: string; }; };
    try {
        await RestAPI.patch({ url: `/channels/${id}`, body: { name: "Transfer" } });
    } catch (e) {
        logger.warn("Could not name the transfer group", e);
    }
    settings.store.transferChannel = id;
    return id;
}

export async function sendKeysToPhone() {
    const me = myId();
    if (!me || !isLoaded()) return notify({ title: "Unter das OS is still loading its keys – try again in a second", kind: "error", app: "Unter das OS" });
    if (!state.keys.length) return notify({ title: "You don't have any keys yet", kind: "info", app: "Unter das OS" });

    const payload: Payload = {
        v: 1,
        keys: state.keys.map(({ key, name, kind, partnerId, source, quantumSafe }) => ({ key, name, kind, partnerId, source, quantumSafe })),
        channels: { ...state.channels },
        rooms: Object.values(state.rooms).map(({ channelId, keyId, name }) => ({ channelId, keyId, name }))
    };

    const tid = toHex(randomBytes(8));
    const code = newCode();
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const plain = await pipe(encodeText(JSON.stringify(payload)), new CompressionStream("deflate-raw"));
    const sealed = seal(await keyFromTransferCode(code, salt), nonce, plain, aadFor(tid, me));
    const raw = new Uint8Array(12 + sealed.length);
    raw.set(nonce);
    raw.set(sealed, 12);
    const data = toB64(raw);
    const parts = Math.ceil(data.length / PART_SIZE);
    if (parts > MAX_PARTS) return notify({ title: "Too many keys for one transfer", kind: "error", app: "Unter das OS" });

    let channelId: string;
    try {
        channelId = await transferChannel();
    } catch (e) {
        logger.error("Could not create the transfer group", e);
        return notify({ title: "Could not create the group for the transfer", kind: "error", app: "Unter das OS" });
    }

    sentHere.set(tid, code);
    NavigationRouter.transitionTo(`/channels/@me/${channelId}`);
    for (let i = 0; i < parts; i++) {
        // Discord allows about 5 messages in 5 seconds per chat
        if (i) await sleep(1200);
        sendMessage(channelId, { content: `🔑 SC1T.${tid}.${i}.${parts}.${toB64(salt)}.${data.slice(i * PART_SIZE, (i + 1) * PART_SIZE)}` }, false);
    }

    openAlert({
        title: "Code for your phone",
        icon: PHONE_ICON,
        iconColor: "green",
        body: (
            <>
                <div className={cl("transfer-code")}>{formatCode(code)}</div>
                On your phone, open the group “Transfer”, tap the card under the message and type this code. The
                messages are deleted as soon as your phone has the keys. Never send the code through Discord.
            </>
        ),
        buttons: [{ label: "Done" }]
    });
}

// ---------------------------------------------------------------- Receiving

async function importTransfer(tid: string, code: string): Promise<"wrong" | "done"> {
    const tr = transfers.get(tid);
    const me = myId();
    if (!tr || !me) throw new Error("Transfer is gone");
    const raw = fromB64(tr.data.join(""));
    const key = await keyFromTransferCode(normalizeCode(code), fromB64(tr.salt));
    const plain = open(key, raw.subarray(0, 12), raw.subarray(12), aadFor(tid, me));
    if (!plain) return "wrong";
    const payload: Payload = JSON.parse(decodeText(await pipe(plain, new DecompressionStream("deflate-raw"))));
    if (payload?.v !== 1 || !Array.isArray(payload.keys)) throw new Error("Unknown transfer format");

    let added = 0;
    for (const k of payload.keys) {
        if (typeof k?.key !== "string" || (k.kind !== "private" && k.kind !== "group")) continue;
        const bytes = fromB64(k.key);
        if (bytes.length !== 32) continue;
        const { isNew } = await addKey(bytes, { name: String(k.name ?? "Key"), kind: k.kind, partnerId: k.partnerId, source: k.source, quantumSafe: k.quantumSafe });
        if (isNew) added++;
    }
    // Chats set up on this device already keep their own choice
    for (const [channelId, keyId] of Object.entries(payload.channels ?? {})) {
        if (state.channels[channelId] || !getKeyBytes(keyId)) continue;
        state.channels[channelId] = keyId;
        state.lastUsed[channelId] = keyId;
    }
    for (const r of payload.rooms ?? []) {
        if (state.rooms[r.channelId] || !getKeyBytes(r.keyId)) continue;
        state.rooms[r.channelId] = { channelId: r.channelId, keyId: r.keyId, name: String(r.name).slice(0, 64), created: Date.now() };
    }
    await save();
    retryLocked();
    notify({ title: added ? `${added} key${added === 1 ? "" : "s"} imported – your messages can be read here now` : "You already had all of these keys", kind: "success", app: "Unter das OS" });
    deleteTransfer(tid);
    return "done";
}

/** Card under the first part: the code on the sending device, the code field on the other one */
export function TransferCard({ messageId }: { messageId: string; }) {
    useStore();
    const [code, setCode] = useState("");
    const [phase, setPhase] = useState<"idle" | "busy" | "wrong">("idle");
    const info = transferMessages.get(messageId);
    const tr = info && transfers.get(info.tid);
    if (!info || !tr || info.part !== 0) return null;

    const sent = sentHere.get(info.tid);
    if (sent) {
        return (
            <div className={cl("card")}>
                <Icon path={PHONE_ICON} size={18} />
                <span className={cl("card-text")}>Keys sent – type <b className={cl("transfer-inline")}>{formatCode(sent)}</b> on your phone</span>
                <Button small variant="gray" onClick={() => deleteTransfer(info.tid)}>Cancel</Button>
            </div>
        );
    }

    const have = tr.data.filter(Boolean).length;
    if (have < tr.parts) {
        return (
            <div className={cl("card")}>
                <Icon path={PHONE_ICON} size={18} />
                <span className={cl("card-text")}>Keys from your other device</span>
                <State spinner>Part {have} of {tr.parts} …</State>
            </div>
        );
    }

    const ready = normalizeCode(code).length === CODE_LENGTH && phase !== "busy";
    const run = async () => {
        if (!ready) return;
        setPhase("busy");
        try {
            setPhase(await importTransfer(info.tid, code) === "wrong" ? "wrong" : "idle");
        } catch (e) {
            logger.error("Importing the keys failed", e);
            notify({ title: "Could not import the keys", kind: "error", app: "Unter das OS" });
            setPhase("idle");
        }
    };

    return (
        <div className={cl("transfer")}>
            <div className={cl("card")}>
                <Icon path={PHONE_ICON} size={18} />
                <span className={cl("card-text")}>Keys from your other device – type the code it shows</span>
            </div>
            <div className={cl("panel")}>
                <TextField
                    className={classes(cl("transfer-field"), phase === "wrong" && cl("field-error"))}
                    value={code}
                    placeholder="XXXX-XXXX-XXXX"
                    maxLength={20}
                    autoCapitalize="characters"
                    autoComplete="off"
                    onChange={v => { setCode(v); if (phase === "wrong") setPhase("idle"); }}
                    onKeyDown={e => { if (e.key === "Enter") run(); }}
                />
                {phase === "wrong" && <span className={cl("hint")}>Wrong code</span>}
                <Button wide icon={ICONS.download} disabled={!ready} onClick={run}>{phase === "busy" ? "Importing …" : "Import keys"}</Button>
            </div>
        </div>
    );
}
