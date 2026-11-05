/*
 * SecretChat – Vaults: a server (e.g. an empty one you made) where only you can read the messages and files.
 * The key is in a key file (keep it on a USB stick) – the file alone unlocks it. It is never saved on this PC:
 * unlocking puts it into memory, locking or quitting Discord forgets it. Someone with your Discord account –
 * or Discord itself – only sees random characters. Lose every copy of the key file and the vault is gone.
 * Key file format: see vaultfile.ts (binary, nothing readable inside).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Logger } from "@utils/Logger";
import { PluginNative } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { ChannelStore, GuildChannelStore, GuildStore, Menu, showToast, Tooltip, useState } from "@webpack/common";

import { Button, confirm, Icon, ICONS, Note, openWindow, Row, Section, Sheet, TextField, ToggleRow } from "../_ui";
import { keyFingerprint, keyIdOf, randomBytes } from "./crypto";
import { forgetFiles } from "./files";
import { LOCK_ICON, UNLOCK_ICON } from "./icons";
import { relockKey, retryLocked } from "./messages";
import { addVault, getKeyBytes, getVault, isVaultUnlocked, lockVault, removeVault, setVaultChannel, unlockVault, useStore, Vault } from "./store";
import { makeKeyFile, MAX_FILE, openKeyFile, PasswordNeeded } from "./vaultfile";

const logger = new Logger("SecretChat");
const Native = VencordNative.pluginHelpers["Unter das OS"] as PluginNative<typeof import("./native")> | undefined;

// ---------------------------------------------------------------- Key file

/** Saves through a save dialog (pick the USB stick there). false = cancelled */
async function saveKeyFile(bytes: Uint8Array) {
    // Neutral name: the file itself reveals nothing, the name shouldn't either (rename it as you like)
    const name = "vault.key";
    if (Native?.save) return Native.save(bytes, name);
    // Browser (phone app): a normal download
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
}

function pickKeyFile(): Promise<File | null> {
    return new Promise(resolve => {
        const input = document.createElement("input");
        input.type = "file";
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.addEventListener("cancel", () => resolve(null));
        input.click();
    });
}

// ---------------------------------------------------------------- Lock / unlock

export function doLock(guildId: string) {
    const vault = getVault(guildId);
    if (!vault) return;
    lockVault(guildId);
    relockKey(vault.keyId);
    forgetFiles(vault.keyId);
    showToast({ text: `Vault “${vault.name}” locked`, variant: "success" });
}

const serverName = (guildId: string) => GuildStore.getGuild(guildId)?.name ?? "Vault";

/** Channels of the server that can have messages (text, announcements, forums, voice channel chats) */
function serverChannels(guildId: string): Channel[] {
    const all: any = GuildChannelStore.getChannels(guildId) ?? {};
    const list = [...(all.SELECTABLE ?? []), ...(all.VOCAL ?? [])].map((x: any) => x.channel).filter(Boolean);
    return list.sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
}

// ---------------------------------------------------------------- Windows

/** Makes a new key, saves it as a key file and turns the server into a vault */
function CreateWindow({ guildId, close }: { guildId: string; close(): void; }) {
    const [understood, setUnderstood] = useState(false);
    const [busy, setBusy] = useState(false);
    const name = serverName(guildId);

    const problem = !understood ? "Confirm that you understood how the vault works" : "";

    const create = async () => {
        if (problem || busy) return;
        setBusy(true);
        try {
            const key = randomBytes(32);
            if (!await saveKeyFile(await makeKeyFile(guildId, name, key))) return;
            await addVault({ guildId, keyId: await keyIdOf(key), fp: await keyFingerprint(key), name, created: Date.now() }, key);
            retryLocked();
            showToast({ text: `“${name}” is now a vault – unlocked until you lock it or quit Discord`, variant: "success" });
            close();
            openVaultWindow(guildId);
        } catch (e) {
            logger.error("Creating the vault failed", e);
            showToast({ text: `Couldn't create the vault: ${String((e as any)?.message ?? e)}`, variant: "critical" });
        } finally {
            setBusy(false);
        }
    };

    return (
        <Sheet
            header={{ app: "Unter das OS", title: "Make a vault", subtitle: `${name} · Testing`, icon: LOCK_ICON, iconColor: "green" }}
            onClose={close}
            notice={problem || undefined}
            actions={[{ label: "Cancel", variant: "gray", onClick: close }, { label: busy ? "Creating …" : "Create key file", disabled: !!problem || busy, onClick: create }]}
        >
            <Note tone="warn">
                Testing feature: don't keep your only copy of anything important in a vault yet.
            </Note>
            <Note>
                Everything you send in this server is encrypted on your PC – your Discord account, someone who hacks it, and Discord
                itself only see random characters. The key is saved in a key file (save it on a USB stick) and never stored on this PC.
                To unlock, you only choose the key file.
            </Note>
            <Section footer="Channel names, times and file sizes stay visible – only the content is encrypted. Big files (over your upload limit) go to Catbox / Gofile, encrypted.">
                <ToggleRow
                    title="I understand"
                    subtitle="The key file is the key: whoever has it can read this vault, and without it nobody ever can again. I'll keep it safe and keep a second copy."
                    checked={understood}
                    onChange={setUnderstood}
                />
            </Section>
        </Sheet>
    );
}

/** Key file → key in memory (older key files also ask for their password). Also re-adds a vault, e.g. on another PC. */
function UnlockWindow({ guildId, close }: { guildId: string; close(): void; }) {
    const [file, setFile] = useState<{ name: string; data: Uint8Array; } | null>(null);
    const [needsPassword, setNeedsPassword] = useState(false);
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const vault = getVault(guildId);
    const name = serverName(guildId);

    const unlock = async (data: Uint8Array, pw?: string) => {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
            const opened = await openKeyFile(data, pw);
            if (opened.server !== guildId) throw new Error(`This key file belongs to another server (“${opened.name}”)`);
            if (vault && opened.keyId !== vault.keyId) throw new Error("This key file belongs to another vault of this server");
            if (vault) await unlockVault(guildId, opened.key);
            else await addVault({ guildId, keyId: opened.keyId, fp: opened.fp, name, created: Date.now() }, opened.key);
            retryLocked();
            showToast({ text: `Vault “${name}” unlocked`, variant: "success" });
            close();
        } catch (e: any) {
            if (e instanceof PasswordNeeded) setNeedsPassword(true);
            else setError(String(e?.message ?? e));
        } finally {
            setBusy(false);
        }
    };

    const choose = async () => {
        setError("");
        const picked = await pickKeyFile();
        if (!picked) return;
        if (picked.size > MAX_FILE) {
            setFile(null);
            setError("That's not a vault key file");
            return;
        }
        const data = new Uint8Array(await picked.arrayBuffer());
        setFile({ name: picked.name, data });
        setNeedsPassword(false);
        setPassword("");
        // Key files without a password unlock right away
        void unlock(data);
    };

    return (
        <Sheet
            header={{ app: "Unter das OS", title: vault ? "Unlock vault" : "Open vault key file", subtitle: name, icon: UNLOCK_ICON, iconColor: "green" }}
            onClose={close}
            notice={error || undefined}
            actions={needsPassword
                ? [{ label: "Cancel", variant: "gray", onClick: close }, { label: busy ? "Unlocking …" : "Unlock", disabled: !file || !password || busy, onClick: () => file && void unlock(file.data, password) }]
                : [{ label: "Cancel", variant: "gray", onClick: close }]}
        >
            <Section title="Key file" footer="The key stays only in memory – until you lock the vault or quit Discord.">
                <Row
                    title={file ? file.name : "No file chosen"}
                    subtitle={busy ? "Unlocking …" : file ? "Vault key file" : "Plug in your USB stick and choose the file"}
                    trailing={<Button small onClick={choose} disabled={busy}>Choose …</Button>}
                />
            </Section>
            {needsPassword && (
                <Section title="Password" footer="This is an older key file with a password. Unlock it once, then save a new key file in the vault settings – that one needs no password.">
                    <div onKeyDown={e => { if (e.key === "Enter" && file && password) void unlock(file.data, password); }}>
                        <Row title="Password" trailing={<TextField type="password" value={password} onChange={setPassword} autoFocus />} />
                    </div>
                </Section>
            )}
        </Sheet>
    );
}

/** Status, lock / unlock, which channels are encrypted, another key file */
function VaultWindow({ guildId, close }: { guildId: string; close(): void; }) {
    useStore();
    const vault = getVault(guildId);
    if (!vault) return null;
    const unlocked = isVaultUnlocked(vault);
    const channels = serverChannels(guildId);

    const saveCopy = async () => {
        const key = getKeyBytesOf(vault);
        if (!key) return;
        try {
            if (await saveKeyFile(await makeKeyFile(guildId, vault.name, key))) showToast({ text: "Key file saved", variant: "success" });
        } catch (e: any) {
            showToast({ text: `Couldn't save the key file: ${e?.message ?? e}`, variant: "critical" });
        }
    };

    const stop = async () => {
        const ok = await confirm({
            title: "Stop using this server as a vault?",
            body: "Its messages stay encrypted. To read them again, open the key file here later (right-click the server → Open vault key file).",
            confirmText: "Stop",
            destructive: true,
            icon: ICONS.trash
        });
        if (!ok) return;
        relockKey(vault.keyId);
        forgetFiles(vault.keyId);
        await removeVault(guildId);
        close();
    };

    return (
        <Sheet
            header={{
                app: "Unter das OS", title: `Vault “${vault.name}”`, subtitle: unlocked ? "Unlocked – until you lock it or quit Discord" : "Locked", live: unlocked,
                actions: unlocked
                    ? <Button small variant="gray" icon={LOCK_ICON} onClick={() => doLock(guildId)}>Lock</Button>
                    : <Button small icon={UNLOCK_ICON} onClick={() => openUnlockWindow(guildId)}>Unlock</Button>
            }}
            onClose={close}
        >
            <Section title="Encrypted channels" footer="New channels are encrypted automatically. Plain channels work like normal Discord.">
                {channels.length ? channels.map(c => (
                    <ToggleRow
                        key={c.id}
                        icon={vault.plain.includes(c.id) ? UNLOCK_ICON : LOCK_ICON}
                        color={vault.plain.includes(c.id) ? "gray" : "green"}
                        title={`#${c.name}`}
                        subtitle={vault.plain.includes(c.id) ? "Plain – everyone with access reads it" : "Encrypted – only with the key file"}
                        checked={!vault.plain.includes(c.id)}
                        onChange={v => void setVaultChannel(guildId, c.id, v)}
                    />
                )) : <Row title="No channels" subtitle="Create a channel in the server first" />}
            </Section>
            <Section title="Key file" footer="Keep two copies (e.g. two USB sticks) somewhere safe – whoever has a copy can read the vault. Older key files with a password keep working.">
                <Row title="Save another key file" subtitle={unlocked ? "A backup copy (no password needed)" : "Unlock the vault first"} trailing={<Button small variant="gray" disabled={!unlocked} onClick={saveCopy}>Save …</Button>} />
            </Section>
            <Section>
                <Row title="Stop using as vault" subtitle="Messages stay encrypted" trailing={<Button small variant="gray" color="red" onClick={stop}>Stop …</Button>} />
            </Section>
        </Sheet>
    );
}

// The key bytes only for "save another key file" – store.ts keeps them in memory, never on disk
const getKeyBytesOf = (v: Vault) => getKeyBytes(v.keyId);

export const openCreateWindow = (guildId: string) => openWindow(close => <CreateWindow guildId={guildId} close={close} />, { size: "small" });
export const openUnlockWindow = (guildId: string) => openWindow(close => <UnlockWindow guildId={guildId} close={close} />, { size: "small" });
export const openVaultWindow = (guildId: string) => openWindow(close => <VaultWindow guildId={guildId} close={close} />, { size: "small" });

// ---------------------------------------------------------------- Context menus

export const guildVaultMenu: NavContextMenuPatchCallback = (children, { guild }: { guild?: { id: string; }; }) => {
    if (!guild?.id) return;
    const vault = getVault(guild.id);
    const items = vault
        ? [
            isVaultUnlocked(vault)
                ? <Menu.MenuItem key="lock" id="vc-secretchat-vault-lock" label="Lock vault" action={() => doLock(guild.id)} />
                : <Menu.MenuItem key="unlock" id="vc-secretchat-vault-unlock" label="Unlock vault …" action={() => openUnlockWindow(guild.id)} />,
            <Menu.MenuItem key="settings" id="vc-secretchat-vault" label="Vault …" action={() => openVaultWindow(guild.id)} />
        ]
        : [
            <Menu.MenuItem key="make" id="vc-secretchat-vault-make" label="Make a vault … (Testing)" action={() => openCreateWindow(guild.id)} />,
            <Menu.MenuItem key="open" id="vc-secretchat-vault-open" label="Open vault key file … (Testing)" action={() => openUnlockWindow(guild.id)} />
        ];
    children.push(<Menu.MenuGroup key="vc-secretchat-vault-group">{items}</Menu.MenuGroup>);
};

export const channelVaultMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    const guildId = channel?.guild_id;
    const vault = getVault(guildId);
    if (!channel || !vault || (channel as any).isThread?.()) return;
    const encrypted = !vault.plain.includes(channel.id);
    children.push(
        <Menu.MenuGroup key="vc-secretchat-vault-channel">
            <Menu.MenuCheckboxItem
                id="vc-secretchat-vault-channel"
                label="Encrypted (vault)"
                checked={encrypted}
                action={() => void setVaultChannel(guildId!, channel.id, !encrypted)}
            />
        </Menu.MenuGroup>
    );
};

/** For the chat bar button / tooltip */
export function vaultStatus(channelId: string) {
    const ch = ChannelStore.getChannel(channelId);
    const vault = getVault(ch?.guild_id);
    return vault ? { vault, unlocked: isVaultUnlocked(vault) } : null;
}

// ---------------------------------------------------------------- Server header

/** Lock next to the server name: grey and closed = locked, green and open = unlocked. Click locks / unlocks. */
export function VaultBadge({ guildId }: { guildId: string; }) {
    useStore();
    const vault = getVault(guildId);
    if (!vault) return null;
    const unlocked = isVaultUnlocked(vault);
    return (
        <Tooltip text={unlocked ? "Vault unlocked – encrypted channels can be read · click to lock" : "Vault locked – click to unlock"}>
            {(tip: any) => (
                <span
                    {...tip}
                    role="button"
                    aria-label={unlocked ? "Lock vault" : "Unlock vault"}
                    className={unlocked ? "vc-secretchat-vault-badge vc-secretchat-vault-open" : "vc-secretchat-vault-badge"}
                    onClick={e => {
                        // Don't open the server menu underneath
                        e.stopPropagation();
                        e.preventDefault();
                        if (unlocked) doLock(guildId);
                        else openUnlockWindow(guildId);
                    }}
                >
                    <Icon path={unlocked ? UNLOCK_ICON : LOCK_ICON} size={16} />
                </span>
            )}
        </Tooltip>
    );
}
