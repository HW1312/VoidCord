/*
 * SecretChat – vault key file. No Discord code, so it can be tested alone.
 *
 * Version 3 (written now) needs no password – the file itself is the key, so whoever has it can open the vault.
 * It still looks like random bytes (nothing readable inside):
 *   [16 bytes salt][12 bytes nonce][ChaCha20-Poly1305 sealed payload]
 * The sealing key comes from the salt (SHA-512) – that only hides the content and catches a changed or wrong
 * file; it is not a password. The payload is the same JSON as in version 2.
 *
 * Version 2 (older, still opened) is binary and protected with a password:
 *   [16 bytes salt][12 bytes nonce][4 bytes PBKDF2 rounds, big endian][ChaCha20-Poly1305 sealed payload]
 * The payload (JSON: server, name, key id, fingerprint, key) is sealed under PBKDF2-SHA-512 of the password;
 * the 32-byte header is the additional data, so the rounds can't be lowered unnoticed.
 * Version 1 (readable JSON with the key sealed inside) is still opened, so older key files keep working.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { decodeText, encodeText, fromB64, keyFingerprint, keyIdOf, open, randomBytes, seal, sha512, toB64 } from "./crypto";

const ITERATIONS = 600_000;
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 10_000_000;
const HEADER = 32;
/** A v2 file is a few hundred bytes – anything big isn't one */
export const MAX_FILE = 16 * 1024;

/** What a key file holds once it's opened */
export interface VaultKey {
    server: string;
    name: string;
    keyId: string;
    fp: string;
    key: Uint8Array;
}

async function passwordKey(password: string, salt: Uint8Array, iterations: number) {
    const base = await crypto.subtle.importKey("raw", encodeText(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-512", salt: salt as BufferSource, iterations }, base, 256);
    return new Uint8Array(bits);
}

async function checked(v: Omit<VaultKey, "keyId" | "fp"> & { keyId: unknown; fp: unknown; }): Promise<VaultKey> {
    if (v.key.length !== 32 || await keyIdOf(v.key) !== v.keyId || await keyFingerprint(v.key) !== v.fp) throw new Error("The key file is damaged");
    return v as VaultKey;
}

/** Opening needs a password: an older key file (version 1 or 2) */
export class PasswordNeeded extends Error {
    constructor() { super("This key file is protected with a password"); }
}

const V3_HEADER = 28;
const v3Key = async (salt: Uint8Array) => (await sha512("UDOS vault v3 file", salt)).slice(0, 32);

async function payloadOf(server: string, name: string, key: Uint8Array) {
    return encodeText(JSON.stringify({ v: 2, server, name, keyId: await keyIdOf(key), fp: await keyFingerprint(key), key: toB64(key) }));
}

async function readPayload(plain: Uint8Array): Promise<VaultKey> {
    let p: any;
    try { p = JSON.parse(decodeText(plain)); } catch { throw new Error("The key file is damaged"); } finally { plain.fill(0); }
    if (p?.v !== 2 || typeof p.server !== "string" || typeof p.key !== "string") throw new Error("The key file is damaged");
    return checked({ server: p.server, name: String(p.name ?? "Vault"), keyId: p.keyId, fp: p.fp, key: fromB64(p.key) });
}

/** The key file (version 3: no password, the file is the key) */
export async function makeKeyFile(server: string, name: string, key: Uint8Array): Promise<Uint8Array> {
    const header = new Uint8Array(V3_HEADER);
    header.set(randomBytes(16), 0);
    header.set(randomBytes(12), 16);
    const payload = await payloadOf(server, name, key);
    const wrap = await v3Key(header.subarray(0, 16));
    const sealed = seal(wrap, header.subarray(16, 28), payload, header);
    wrap.fill(0);
    payload.fill(0);
    const out = new Uint8Array(V3_HEADER + sealed.length);
    out.set(header);
    out.set(sealed, V3_HEADER);
    return out;
}

/** Version 3 – null if it isn't one (then it's an older file that needs its password) */
async function openV3(bytes: Uint8Array): Promise<VaultKey | null> {
    if (bytes.length < V3_HEADER + 16 + 2) return null;
    const header = bytes.subarray(0, V3_HEADER);
    const wrap = await v3Key(header.subarray(0, 16));
    const plain = open(wrap, header.subarray(16, 28), bytes.subarray(V3_HEADER), header);
    wrap.fill(0);
    return plain ? readPayload(plain) : null;
}

/** Version 2 key file (with password) – only kept for tests and old files */
export async function makeKeyFileV2(server: string, name: string, key: Uint8Array, password: string): Promise<Uint8Array> {
    const header = new Uint8Array(HEADER);
    header.set(randomBytes(16), 0);
    header.set(randomBytes(12), 16);
    new DataView(header.buffer).setUint32(28, ITERATIONS);
    const payload = await payloadOf(server, name, key);
    const wrap = await passwordKey(password, header.subarray(0, 16), ITERATIONS);
    const sealed = seal(wrap, header.subarray(16, 28), payload, header);
    wrap.fill(0);
    payload.fill(0);
    const out = new Uint8Array(HEADER + sealed.length);
    out.set(header);
    out.set(sealed, HEADER);
    return out;
}

const WRONG = "Wrong password";

/**
 * Opens a key file: version 3 without a password; versions 1 / 2 throw PasswordNeeded until the password is given.
 * Throws on a wrong password or a changed / foreign file.
 */
export async function openKeyFile(bytes: Uint8Array, password?: string): Promise<VaultKey> {
    if (bytes.length > MAX_FILE) throw new Error("That's not a vault key file");
    // Version 1 starts with "{"
    if (bytes[0] === 0x7B) {
        if (!password) throw new PasswordNeeded();
        return openV1(decodeText(bytes), password);
    }
    const v3 = await openV3(bytes);
    if (v3) return v3;
    // Only a real version 2 file has a sensible round count there – anything else is foreign or changed
    const rounds = bytes.length >= HEADER ? new DataView(bytes.buffer, bytes.byteOffset).getUint32(28) : 0;
    if (bytes.length < HEADER + 16 + 2 || rounds < MIN_ITERATIONS || rounds > MAX_ITERATIONS) throw new Error("That's not a vault key file (or it was changed)");
    if (!password) throw new PasswordNeeded();

    const header = bytes.subarray(0, HEADER);
    const iterations = new DataView(header.buffer, header.byteOffset).getUint32(28);
    if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new Error(WRONG);
    const wrap = await passwordKey(password, header.subarray(0, 16), iterations);
    const plain = open(wrap, header.subarray(16, 28), bytes.subarray(HEADER), header);
    wrap.fill(0);
    if (!plain) throw new Error(WRONG);
    return readPayload(plain);
}

// ---------------------------------------------------------------- Version 1 (readable JSON, still opened)

async function openV1(text: string, password: string): Promise<VaultKey> {
    let f: any;
    try { f = JSON.parse(text); } catch { throw new Error("That's not a vault key file"); }
    if (f?.format !== "unter-das-os-vault" || f.version !== 1 || typeof f.server !== "string" || typeof f.key !== "string"
        || f.kdf?.name !== "PBKDF2-SHA512" || !(f.kdf.iterations >= MIN_ITERATIONS && f.kdf.iterations <= MAX_ITERATIONS)) {
        throw new Error("That's not a vault key file");
    }
    const wrap = await passwordKey(password, fromB64(f.kdf.salt), f.kdf.iterations);
    const key = open(wrap, fromB64(f.nonce), fromB64(f.key), encodeText(`UDOS vault v1|${f.server}|${f.keyId}|${f.fp}`));
    wrap.fill(0);
    if (!key) throw new Error(WRONG);
    return checked({ server: f.server, name: String(f.name ?? "Vault"), keyId: f.keyId, fp: f.fp, key });
}
