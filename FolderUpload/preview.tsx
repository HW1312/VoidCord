/*
 * FolderUpload – "Look inside": browse a zip from the chat like a folder and open single files without downloading it
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";
import { showToast, useEffect, useMemo, useState } from "@webpack/common";

import { Badge, Button, Empty, Icon, ICONS, Note, openWindow, RoundButton, Row, Section, Sheet, Spinner } from "../_ui";
import { isSecret } from "./folder";
import { readIndex, readItem, RemoteZip, remoteZip, ZipIndex, ZipItem } from "./zipread";

const Native = VencordNative.pluginHelpers.FolderUpload as PluginNative<typeof import("./native")>;

const MB = 1024 * 1024;
/** Opened files are downloaded on their own – bigger ones only make sense after downloading the zip */
const MAX_OPEN = 50 * MB;
const MAX_TEXT_SHOWN = 256 * 1024;

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;
const MIME: Record<string, string> = { svg: "image/svg+xml", jpg: "image/jpeg", ico: "image/x-icon" };

export function formatSize(bytes: number) {
    if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const parentOf = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

interface Folder { dirs: Set<string>; files: ZipItem[]; }

/** dir path → its subfolders and files. Folders only implied by file paths are added too. */
function buildTree(items: ZipItem[]) {
    const tree = new Map<string, Folder>();
    const folder = (path: string) => {
        let f = tree.get(path);
        if (!f) {
            f = { dirs: new Set(), files: [] };
            tree.set(path, f);
            if (path) folder(parentOf(path)).dirs.add(path);
        }
        return f;
    };
    folder("");
    for (const it of items) {
        if (it.dir) folder(it.path);
        else folder(parentOf(it.path)).files.push(it);
    }
    return tree;
}

/** No zero bytes and mostly printable → show as text */
function looksLikeText(data: Uint8Array) {
    const n = Math.min(data.length, 8192);
    let odd = 0;
    for (let i = 0; i < n; i++) {
        const b = data[i];
        if (b === 0) return false;
        if (b < 9 || (b > 13 && b < 32)) odd++;
    }
    return odd <= n * 0.02;
}

async function save(data: Uint8Array, name: string) {
    try {
        if (!Native?.saveFile) throw new Error("Fully quit Discord (also from the tray) and start it again");
        if (await Native.saveFile(data, name)) showToast({ text: "Saved", variant: "success" });
    } catch (e) {
        showToast({ text: `Couldn't save – ${e instanceof Error ? e.message : e}`, variant: "critical" });
    }
}

function FileView({ zip, item }: { zip: RemoteZip; item: ZipItem; }) {
    const [data, setData] = useState<Uint8Array | null>(null);
    const [error, setError] = useState<string | null>(null);
    const name = baseOf(item.path);

    useEffect(() => {
        let alive = true;
        readItem(zip, item, MAX_OPEN).then(d => alive && setData(d), e => alive && setError(e instanceof Error ? e.message : String(e)));
        return () => { alive = false; };
    }, [item]);

    const imageUrl = useMemo(() => {
        if (!data || !IMAGE.test(name)) return null;
        const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
        return URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[ext] ?? `image/${ext}` }));
    }, [data]);
    useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

    const text = useMemo(() => {
        if (!data || imageUrl || !looksLikeText(data)) return null;
        return new TextDecoder().decode(data.subarray(0, MAX_TEXT_SHOWN));
    }, [data, imageUrl]);

    if (error) return <Empty icon={ICONS.warning} title="Can't open this file" hint={error} />;
    if (!data) return <div className="vc-folderupload-loading"><Spinner size={20} /></div>;

    return (
        <div className="vc-folderupload-file">
            {isSecret(item.path) && <Note tone="warn">This looks like a secret file (passwords, tokens or keys).</Note>}
            {imageUrl
                ? <img className="vc-folderupload-image" src={imageUrl} alt={name} />
                : text != null
                    ? <pre className="vc-folderupload-text">{text}</pre>
                    : <Empty icon={ICONS.file} title="No preview for this file type" hint="Save it to open it on your PC." />}
            {text != null && data.length > MAX_TEXT_SHOWN && <span className="vc-folderupload-dim">Only the first {formatSize(MAX_TEXT_SHOWN)} are shown.</span>}
        </div>
    );
}

function ZipWindow({ name, url, close }: { name: string; url: string; close(): void; }) {
    const zip = useMemo(() => remoteZip(url), [url]);
    const [index, setIndex] = useState<ZipIndex | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dir, setDir] = useState("");
    const [open, setOpen] = useState<ZipItem | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let alive = true;
        readIndex(zip).then(ix => {
            if (!alive) return;
            setIndex(ix);
            // A zip of one folder: start inside it
            const root = buildTree(ix.items).get("")!;
            if (root.dirs.size === 1 && !root.files.length) setDir([...root.dirs][0]);
        }, e => alive && setError(e instanceof Error ? e.message : String(e)));
        return () => { alive = false; };
    }, [zip]);

    const tree = useMemo(() => index ? buildTree(index.items) : null, [index]);
    const files = index?.items.filter(i => !i.dir) ?? [];
    const unpacked = files.reduce((n, f) => n + f.size, 0);
    const secrets = files.filter(f => isSecret(f.path)).length;

    const here = tree?.get(dir);
    const countIn = (path: string) => {
        const f = tree?.get(path);
        return f ? f.dirs.size + f.files.length : 0;
    };

    const crumbs = open ? open.path : dir;
    const back = () => open ? setOpen(null) : setDir(parentOf(dir));

    const saveOpen = async () => {
        if (!open) return;
        setBusy(true);
        try {
            await save(await readItem(zip, open, MAX_OPEN), baseOf(open.path));
        } catch (e) {
            showToast({ text: e instanceof Error ? e.message : String(e), variant: "critical" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <Sheet
            header={{
                app: "FolderUpload",
                title: name,
                subtitle: index ? `${plural(files.length, "file")} · ${formatSize(unpacked)} unpacked` : "Reading the zip …",
                icon: ICONS.folder,
                iconColor: "blue"
            }}
            onClose={close}
            height="min(640px, 82vh)"
            top={index && (crumbs || open) ? (
                <div className="vc-folderupload-crumbs">
                    <RoundButton icon={ICONS.back} label="Back" onClick={back} />
                    <span className="vc-folderupload-path">{crumbs}</span>
                </div>
            ) : undefined}
            footer={open && (
                <div className="vc-folderupload-actions">
                    <span className="vc-folderupload-dim">{formatSize(open.size)}</span>
                    <Button variant="gray" small icon={ICONS.download} disabled={busy || open.encrypted} onClick={saveOpen}>Save file</Button>
                </div>
            )}
        >
            {error && <Empty icon={ICONS.warning} title="Can't look inside" hint={error} />}
            {!error && !index && <div className="vc-folderupload-loading"><Spinner size={20} /></div>}
            {index && open && <FileView zip={zip} item={open} />}
            {index && !open && here && (
                <>
                    {!dir && secrets > 0 && <Note tone="warn">{plural(secrets, "file")} in here look like secrets (.env, keys).</Note>}
                    {here.dirs.size + here.files.length === 0
                        ? <Empty icon={ICONS.folder} title="Empty folder" />
                        : (
                            <Section>
                                {[...here.dirs].sort((a, b) => a.localeCompare(b)).map(d => (
                                    <Row
                                        key={d}
                                        leading={<Icon path={ICONS.folder} size={18} />}
                                        title={baseOf(d)}
                                        subtitle={plural(countIn(d), "item")}
                                        chevron
                                        onClick={() => setDir(d)}
                                    />
                                ))}
                                {[...here.files].sort((a, b) => a.path.localeCompare(b.path)).map(f => (
                                    <Row
                                        key={f.path}
                                        leading={<Icon path={IMAGE.test(f.path) ? ICONS.image : ICONS.file} size={18} />}
                                        title={baseOf(f.path)}
                                        subtitle={formatSize(f.size)}
                                        trailing={f.encrypted
                                            ? <Badge color="gray">Password</Badge>
                                            : isSecret(f.path) ? <Badge color="orange">Secret?</Badge> : undefined}
                                        onClick={() => setOpen(f)}
                                    />
                                ))}
                            </Section>
                        )}
                </>
            )}
        </Sheet>
    );
}

export function openZipPreview(name: string, url: string) {
    openWindow(close => <ZipWindow name={name} url={url} close={close} />, { size: "medium" });
}

// ---------------------------------------------------------------- Button under messages

export interface ZipLink { name: string; url: string; size?: number; }

const ZIP_TYPE = /zip/i;
const CATBOX_ZIP = /https:\/\/files\.catbox\.moe\/[\w-]+\.zip\b/gi;

export function zipsOf(message: any): ZipLink[] {
    const out: ZipLink[] = [];
    for (const a of message?.attachments ?? []) {
        if (typeof a?.url !== "string") continue;
        if (/\.zip$/i.test(a.filename ?? "") || ZIP_TYPE.test(a.content_type ?? "")) out.push({ name: a.filename, url: a.url, size: a.size });
    }
    for (const url of new Set<string>(message?.content?.match(CATBOX_ZIP) ?? [])) out.push({ name: baseOf(url), url });
    return out;
}

export function ZipButtons({ zips }: { zips: ZipLink[]; }) {
    return (
        <div className="vc-folderupload-peeks">
            {zips.map(z => (
                <button key={z.url} type="button" className="vc-folderupload-peek" onClick={() => openZipPreview(z.name, z.url)}>
                    <Icon path={ICONS.folder} size={14} />
                    <span>Look inside{zips.length > 1 ? ` ${z.name}` : ""}</span>
                </button>
            ))}
        </div>
    );
}
