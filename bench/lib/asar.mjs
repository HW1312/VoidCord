// Minimal asar writer/reader for tiny stub archives (no folders, no unpacked files).
// Format: [UInt32 4][UInt32 headerBuf.length] + headerBuf([UInt32 payloadLen][UInt32 strLen][json, padded to 4]) + file data

export function buildAsar(files) {
    const header = { files: {} };
    const blobs = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const buf = Buffer.from(content, "utf8");
        header.files[name] = { size: buf.length, offset: String(offset) };
        blobs.push(buf);
        offset += buf.length;
    }

    const json = Buffer.from(JSON.stringify(header), "utf8");
    const padded = Math.ceil(json.length / 4) * 4;
    const headerBuf = Buffer.alloc(8 + padded);
    headerBuf.writeUInt32LE(4 + padded, 0);
    headerBuf.writeUInt32LE(json.length, 4);
    json.copy(headerBuf, 8);

    const sizeBuf = Buffer.alloc(8);
    sizeBuf.writeUInt32LE(4, 0);
    sizeBuf.writeUInt32LE(headerBuf.length, 4);

    return Buffer.concat([sizeBuf, headerBuf, ...blobs]);
}

export function readAsar(buf) {
    const headerLen = buf.readUInt32LE(4);
    const strLen = buf.readUInt32LE(12);
    const header = JSON.parse(buf.subarray(16, 16 + strLen).toString("utf8"));
    const base = 8 + headerLen;
    const out = {};
    for (const [name, entry] of Object.entries(header.files)) {
        if (entry.size == null) continue;
        const start = base + Number(entry.offset);
        out[name] = buf.subarray(start, start + entry.size).toString("utf8");
    }
    return out;
}
