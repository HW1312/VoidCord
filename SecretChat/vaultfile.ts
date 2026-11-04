/*
 * SecretChat – vault key file. No Discord code, so it can be tested alone.
 *
 * Version 2 (written now) is binary and reveals nothing – no name, no server, no "this is a key file":
 *   [16 bytes salt][12 bytes nonce][4 bytes PBKDF2 rounds, big endian][ChaCha20-Poly1305 sealed payload]
 * The payload (JSON: server, name, key id, fingerprint, key) is sealed under PBKDF2-SHA-512 of the password;
 * the 32-byte header is the additional data, so the rounds can't be lowered unnoticed.
 * Version 1 (readable JSON with the key sealed inside) is still opened, so older key files keep working.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { decodeText, encodeText, fromB64, keyFingerprint, keyIdOf, open, randomBytes, seal, toB64 } from "./crypto";

const ITERATIONS = 600_000;
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 10_000_000;
const HEADER = 32;
export const MIN_PASSWORD = 12;
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

/** The new key file (binary, version 2) */
export async function makeKeyFile(server: string, name: string, key: Uint8Array, password: string): Promise<Uint8Array> {
    const header = new Uint8Array(HEADER);
    header.set(randomBytes(16), 0);
    header.set(randomBytes(12), 16);
    new DataView(header.buffer).setUint32(28, ITERATIONS);
    const payload = encodeText(JSON.stringify({ v: 2, server, name, keyId: await keyIdOf(key), fp: await keyFingerprint(key), key: toB64(key) }));
    const wrap = await passwordKey(password, header.subarray(0, 16), ITERATIONS);
    const sealed = seal(wrap, header.subarray(16, 28), payload, header);
    wrap.fill(0);
    payload.fill(0);
    const out = new Uint8Array(HEADER + sealed.length);
    out.set(header);
    out.set(sealed, HEADER);
    return out;
}

const WRONG = "Wrong password, or not a vault key file";

/** Opens a key file (version 2, or the older JSON version 1). Throws on a wrong password or a changed file. */
export async function openKeyFile(bytes: Uint8Array, password: string): Promise<VaultKey> {
    if (bytes.length > MAX_FILE) throw new Error("That's not a vault key file");
    // Version 1 starts with "{"
    if (bytes[0] === 0x7B) return openV1(decodeText(bytes), password);
    if (bytes.length < HEADER + 16 + 2) throw new Error(WRONG);

    const header = bytes.subarray(0, HEADER);
    const iterations = new DataView(header.buffer, header.byteOffset).getUint32(28);
    if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new Error(WRONG);
    const wrap = await passwordKey(password, header.subarray(0, 16), iterations);
    const plain = open(wrap, header.subarray(16, 28), bytes.subarray(HEADER), header);
    wrap.fill(0);
    if (!plain) throw new Error(WRONG);

    let p: any;
    try { p = JSON.parse(decodeText(plain)); } catch { throw new Error("The key file is damaged"); } finally { plain.fill(0); }
    if (p?.v !== 2 || typeof p.server !== "string" || typeof p.key !== "string") throw new Error("The key file is damaged");
    return checked({ server: p.server, name: String(p.name ?? "Vault"), keyId: p.keyId, fp: p.fp, key: fromB64(p.key) });
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
