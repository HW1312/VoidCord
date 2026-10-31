/*
 * FolderUpload – Vencord Userplugin
 * Drop or paste a folder into a chat (or pick one under the + button) and it's sent as a .zip. What the folder's
 * .gitignore lists stays out, and .env files / private keys need a confirmation first. The zip goes through
 * Discord's normal upload, so "Unter das OS" encrypts it in encrypted chats and GofileUpload takes it when it's too big.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { ChannelStore, DraftType, Menu, PermissionsBits, PermissionStore, SelectedChannelStore, UploadHandler } from "@webpack/common";

import { Icon, ICONS, notify, openAlert } from "../_ui";
import { addFilesHooks } from "../ChatPopout/upload";
import { channelKey } from "../SecretChat/store";
import { entrySource, FolderSource, isSecret, pickFolderSource, scanFolder, zipFolder } from "./folder";
import { zipsOf, ZipButtons } from "./preview";

const logger = new Logger("FolderUpload");
const APP = "FolderUpload";
const MB = 1024 * 1024;

let running = false;

const settings = definePluginSettings({
    useGitignore: {
        type: OptionType.BOOLEAN,
        description: "Leave out what the folder's .gitignore files list (the .git folder is always left out)",
        default: true
    },
    warnSecrets: {
        type: OptionType.BOOLEAN,
        description: "Ask before sending .env files and private keys (.pem, .key, id_rsa …)",
        default: true
    },
    zipPreview: {
        type: OptionType.BOOLEAN,
        description: "Show a \"Look inside\" button under .zip files to browse them without downloading",
        default: true
    }
});

function formatSize(bytes: number) {
    return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

function isEncrypted(channel: Channel) {
    try {
        return isPluginEnabled("Unter das OS") && !!channelKey(channel.id);
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------- Sending

/** "send" = with the secret files, "skip" = without them, null = cancelled */
async function askSecrets(folder: string, secrets: string[], channel: Channel) {
    const shown = secrets.slice(0, 6);
    const choice = await openAlert({
        title: `“${folder}” contains ${secrets.length === 1 ? "a secret file" : `${secrets.length} secret files`}`,
        icon: ICONS.warning,
        iconColor: "orange",
        body: (
            <>
                <p>.env files and keys usually hold passwords, tokens or API keys:</p>
                <ul className="vc-folderupload-list">
                    {shown.map(p => <li key={p}>{p}</li>)}
                    {secrets.length > shown.length && <li>… and {secrets.length - shown.length} more</li>}
                </ul>
                <p>{isEncrypted(channel)
                    ? "This chat is encrypted – only people with its key can open the zip."
                    : "Anyone who can see this chat can download the zip and read them."}</p>
            </>
        ),
        buttons: [
            { label: "Cancel" },
            { label: "Send anyway", variant: "destructive" },
            { label: "Leave them out" }
        ]
    });
    return choice === 2 ? "skip" : choice === 1 ? "send" : null;
}

/** Scans, asks about secrets, zips and hands the zip to deliver (Discord's upload or a ChatPopout window) */
async function sendFolder(src: FolderSource, channel: Channel, deliver: (zip: File) => void) {
    try {
        const scan = await scanFolder(src, settings.store.useGitignore);
        let files = scan.files;

        let skipped = 0;
        const secrets = settings.store.warnSecrets ? files.filter(f => isSecret(f.path)).map(f => f.path) : [];
        if (secrets.length) {
            const choice = await askSecrets(src.name, secrets, channel);
            if (!choice) return;
            if (choice === "skip") {
                files = files.filter(f => !secrets.includes(f.path));
                skipped = secrets.length;
            }
        }

        if (!files.length) {
            notify({
                title: `Nothing to send in “${src.name}”`,
                body: scan.ignored ? "Everything in it is left out by .gitignore" : "The folder is empty",
                kind: "attention",
                app: APP
            });
            return;
        }

        const total = files.reduce((n, f) => n + f.size, 0);
        if (files.length > 300 || total > 20 * MB) {
            notify({ title: `Zipping “${src.name}” …`, body: `${plural(files.length, "file")} · ${formatSize(total)}`, kind: "info", app: APP });
        }

        const { file, rawBytes } = await zipFolder(src, scan, files);
        const notes = [`${plural(files.length, "file")} · ${formatSize(rawBytes)} → ${formatSize(file.size)}`];
        if (scan.ignored) notes.push(`${plural(scan.ignored, "item")} left out by .gitignore`);
        if (skipped) notes.push(`${plural(skipped, "secret file")} left out`);
        notify({ title: `Zipped “${src.name}”`, body: notes.join(" · "), kind: "success", icon: ICONS.folder, app: APP });

        deliver(file);
    } catch (e) {
        logger.error("Sending a folder failed", e);
        notify({ title: `Couldn't zip “${src.name}”`, body: e instanceof Error ? e.message : String(e), kind: "error", app: APP });
    } finally {
        src.close?.();
    }
}

const toDiscord = (channel: Channel, draftType: number) => (zip: File) => UploadHandler.promptToUpload([zip], channel, draftType);

// ---------------------------------------------------------------- Dropped / pasted folders

interface DroppedFolder {
    entry: FileSystemDirectoryEntry;
    /** What Chromium shows Discord for the folder: an empty file with its name */
    file: File | null;
    at: number;
    claimed: boolean;
}

let dropped: DroppedFolder[] = [];

/** Must run during the event – the entries can't be read from the DataTransfer afterwards */
function foldersIn(items: DataTransferItemList | null | undefined) {
    const found: DroppedFolder[] = [];
    for (const item of Array.from(items ?? [])) {
        if (item.kind !== "file") continue;
        const entry = item.webkitGetAsEntry?.();
        if (entry?.isDirectory) found.push({ entry: entry as FileSystemDirectoryEntry, file: item.getAsFile(), at: Date.now(), claimed: false });
    }
    return found;
}

function remember(found: DroppedFolder[]) {
    const now = Date.now();
    dropped = [...dropped.filter(d => !d.claimed && now - d.at < 30_000), ...found];
}

const isFolderFile = (d: DroppedFolder, f: File) =>
    d.file === f || (d.entry.name === f.name && f.type === "" && f.size === (d.file?.size ?? 0));

/**
 * Discord's drop handler refuses folders ("Invalid file type") before they reach promptToUpload, so drops with
 * folders are taken here first (capture runs before Discord): Discord gets the same drop without the folders, which
 * also ends its "Upload to …" overlay, and the folders are zipped for the open chat.
 */
function onDrop(e: DragEvent) {
    if (!running || !e.isTrusted || !e.dataTransfer) return;
    const target = e.target instanceof Element ? e.target : null;
    // ChatPopout / room windows handle their own drops (addFilesHooks)
    if (target?.closest('[class*="vc-chatpopout-"], [class*="vc-secretchat-"]')) return;

    const found = foldersIn(e.dataTransfer.items);
    if (!found.length) return;
    const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    // No chat open or no right to attach files: Discord shows its own message
    if (!channel || (channel.guild_id && !PermissionStore.can(PermissionsBits.ATTACH_FILES, channel))) return;

    const rest = Array.from(e.dataTransfer.files).filter(f => !found.some(d => isFolderFile(d, f)));
    e.preventDefault();
    e.stopImmediatePropagation();

    const data = new DataTransfer();
    for (const f of rest) data.items.add(f);
    (target ?? document.body).dispatchEvent(new DragEvent("drop", {
        bubbles: true, cancelable: true, composed: true, dataTransfer: data,
        clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey
    }));

    for (const d of found) void sendFolder(entrySource(d.entry), channel, toDiscord(channel, DraftType.ChannelMessage));
}

/** ChatPopout / "Unter das OS" room windows: their own drop and paste */
function popoutHook(channel: Channel, files: File[], data: DataTransfer | null, attach: (files: File[]) => void) {
    if (!running || !data) return files;
    const found = foldersIn(data.items);
    if (!found.length) return files;
    // The window listener saw this drop too (rooms layer in the main window) – it's handled here
    for (const d of dropped) if (found.some(f => f.entry.name === d.entry.name)) d.claimed = true;
    for (const d of found) void sendFolder(entrySource(d.entry), channel, zip => attach([zip]));
    return files.filter(f => !found.some(d => isFolderFile(d, f)));
}

const FolderIcon = () => <Icon path={ICONS.folder} size={18} />;

const attachMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel || (channel.guild_id && !PermissionStore.can(PermissionsBits.ATTACH_FILES, channel))) return;
    children.push(
        <Menu.MenuItem
            id="vc-folder-upload"
            label="Upload a Folder"
            iconLeft={FolderIcon}
            leadingAccessory={{ type: "icon", icon: FolderIcon }}
            action={async () => {
                try {
                    const src = await pickFolderSource();
                    if (src) await sendFolder(src, channel, toDiscord(channel, DraftType.ChannelMessage));
                } catch (e) {
                    logger.error("Folder picker failed", e);
                    notify({ title: "Couldn't open the folder", body: e instanceof Error ? e.message : String(e), kind: "error", app: APP });
                }
            }}
        />
    );
};

// ---------------------------------------------------------------- Plugin

export default definePlugin({
    name: "FolderUpload",
    description: "Send whole folders: drop or paste one into a chat (or use \"Upload a Folder\" under +) and it's sent as a .zip, without what its .gitignore lists, after a warning about .env files",
    about: "Drop or paste a folder into a chat, or pick one under the + button, and it's zipped and attached for you. Files the folder's .gitignore lists stay out, and you're asked first if .env files or private keys would go along. In encrypted chats the zip is sent encrypted. Any .zip in a chat gets a \"Look inside\" button to browse it and open single files without downloading it.",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Chat", "Utility"],
    settings,

    patches: [
        {
            // UploadHandler.promptToUpload (paste) – the folder comes in as an empty file. It's taken out here and
            // sent back in as a zip, before "Unter das OS" (encryption) and GofileUpload (too big) look at the files.
            // Their blocks (/*vcSC*/, {let vcKeep=) may already sit there – this one always goes first.
            find: "Unexpected mismatch between files and file metadata",
            replacement: {
                match: /(?<=async function \i\((\i),(\i),(\i)\)\{)(?=\/\*vcSC\*\/|\{let vcKeep=|let\{filesMetadata:)/,
                replace: "/*vcFU*/{let vcFU=$self.takeFolders($1,$2,$3,arguments[3]);if(vcFU!=null){if(!vcFU.length)return;$1=vcFU}}/*vcFU*/"
            }
        },
        {
            // Pasting: Discord drops folders with an error ("is_directory") – let them through to promptToUpload
            find: 'error:"is_directory"',
            replacement: {
                match: /if\(null!=(\i)&&!1===\1\.isFile\)\{(?=\i\.push\(\{item:(\i),error:"is_directory"\}\))/,
                replace: "if(null!=$1&&!1===$1.isFile&&!$self.allowPastedFolder($1,$2)){"
            }
        }
    ],

    contextMenus: {
        "channel-attach": attachMenu
    },

    renderMessageAccessory: ({ message }) => {
        if (!settings.store.zipPreview) return null;
        const zips = zipsOf(message);
        return zips.length ? <ZipButtons zips={zips} /> : null;
    },

    /** Returns null to leave the files alone, otherwise the files without the folders (those are zipped and sent) */
    takeFolders(files: ArrayLike<File> | null, channel: Channel | null, draftType: number, options?: { filesMetadata?: unknown[]; }): File[] | null {
        try {
            if (!running || !files?.length || !channel || !dropped.length) return null;
            const list = Array.from(files);
            const hits = list.map(f => {
                const d = dropped.find(d => !d.claimed && isFolderFile(d, f));
                if (d) d.claimed = true;
                return d;
            });
            if (!hits.some(Boolean)) return null;

            const keep: File[] = [];
            const keepMeta: unknown[] = [];
            list.forEach((f, i) => {
                if (hits[i]) return;
                keep.push(f);
                if (options?.filesMetadata) keepMeta.push(options.filesMetadata[i]);
            });
            if (options?.filesMetadata) options.filesMetadata = keepMeta;

            for (const d of hits) if (d) void sendFolder(entrySource(d.entry), channel, toDiscord(channel, draftType ?? DraftType.ChannelMessage));
            return keep;
        } catch (e) {
            logger.error("takeFolders failed", e);
            return null;
        }
    },

    /** true = Discord keeps the pasted folder (as an empty file) instead of showing its "can't upload" error */
    allowPastedFolder(entry: FileSystemEntry, item: DataTransferItem) {
        try {
            if (!running || !entry.isDirectory) return false;
            const file = item.getAsFile();
            if (!file) return false;
            remember([{ entry: entry as FileSystemDirectoryEntry, file, at: Date.now(), claimed: false }]);
            return true;
        } catch {
            return false;
        }
    },

    start() {
        running = true;
        window.addEventListener("drop", onDrop, true);
        addFilesHooks.add(popoutHook);
    },

    stop() {
        running = false;
        window.removeEventListener("drop", onDrop, true);
        addFilesHooks.delete(popoutHook);
        dropped = [];
    }
});
