/*
 * FakeRobux – window (Profile / Send / History), settings panel and title bar button
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";
import "./roblox.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { findComponentByCodeLazy } from "@webpack";
import { useState } from "@webpack/common";

import { Button, classes, confirm, Empty, Field, Icon, Note, openWindow, Pill, Pills, Row, Section, Sheet, Spinner, Stats, TextField, ToggleRow } from "../_ui";
import { getUser, lookupUser } from "./api";
import { abbr, fmt, fmtDate, GIFT_PATH, HISTORY_PATH, Robux, ROBLOX_PATH, RobloxLogo, ROBUX_PATH, RobuxIcon, SimulatedTag, Tabs, THEME, useAsync, UserAvatar } from "./components";
import { HistoryEntry, MAX_BALANCE, setBalance, settings } from "./index";
import { openReceipt } from "./purchase";
import { Profile } from "./profile";
import { SendView } from "./send";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

const ICON_COLOR = "gray";
const BALANCE_PRESETS = [1_000, 10_000, 100_000, 1_000_000, 10_000_000];

const errorText = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

// ---------------------------------------------------------------- Account (shared by window + settings)

/** Username field that checks the name with Roblox before saving it */
function AccountForm({ compact }: { compact?: boolean; }) {
    const { username } = settings.use(["username"]);
    const [value, setValue] = useState(username);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const save = async () => {
        const name = value.trim();
        if (!name || busy) return;
        setBusy(true);
        setError(null);
        try {
            const user = await lookupUser(name);
            if (!user) return setError(`No Roblox user called “${name}”.`);
            settings.store.username = user.name;
            settings.store.userId = user.id;
            setValue(user.name);
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Row
                title={
                    <Field label={compact ? undefined : "Roblox username"}>
                        <TextField value={value} placeholder="Roblox username" onChange={setValue} onKeyDown={e => { if (e.key === "Enter") save(); }} />
                    </Field>
                }
                trailing={<Button small onClick={save} disabled={busy || !value.trim() || value.trim() === username}>{busy ? <Spinner /> : "Load"}</Button>}
            />
            {error && <Row title={<span className="vc-fakerobux-error">{error}</span>} />}
        </>
    );
}

function BalanceEditor() {
    const { balance } = settings.use(["balance"]);
    const [value, setValue] = useState(String(balance));
    const parsed = Math.floor(Number(value) || 0);

    return (
        <>
            <Row
                leading={<span className="vc-fakerobux-robux-glyph"><RobuxIcon size={18} /></span>}
                title={
                    <TextField
                        value={value}
                        inputMode="numeric"
                        onChange={v => setValue(v.replace(/[^\d]/g, "").slice(0, 12))}
                        onKeyDown={e => { if (e.key === "Enter") setBalance(parsed); }}
                    />
                }
                trailing={<Button small onClick={() => setBalance(parsed)} disabled={parsed === balance || parsed > MAX_BALANCE}>Set</Button>}
            />
            <Row title={
                <Pills>
                    {BALANCE_PRESETS.map(p => (
                        <Pill key={p} selected={balance === p} onClick={() => { setBalance(p); setValue(String(p)); }}>
                            <Robux value={p} size={12} />
                        </Pill>
                    ))}
                </Pills>
            } />
        </>
    );
}

function ProfileView() {
    const { userId } = settings.use(["userId"]);
    const user = useAsync(async () => userId ? getUser(userId) : null, [userId]);

    if (!userId) {
        return (
            <>
                <Empty icon={ROBLOX_PATH} title="Connect your Roblox profile" hint="Only your public profile is read - no login, no password." />
                <Section><AccountForm compact /></Section>
            </>
        );
    }
    if (user.error) return <Note tone="bad">{user.error}</Note>;
    if (!user.value) return <Empty title="Loading profile…"><Spinner /></Empty>;
    return <Profile user={user.value} own />;
}

// ---------------------------------------------------------------- History tab

function HistoryView() {
    const { history } = settings.use(["history"]);

    if (!history.length) {
        return <Empty icon={HISTORY_PATH} title="No transactions yet" hint="Simulated donations and gifts show up here." />;
    }

    const total = history.reduce((s, e) => s + e.amount, 0);

    return (
        <>
            <Stats items={[
                { value: fmt(history.length), label: "Transactions" },
                { value: <Robux value={total} size={16} />, label: "Spent (simulated)" }
            ]} />
            <Section
                title="History"
                right={
                    <Button small variant="plain" color="red" onClick={async () => {
                        if (await confirm({ title: "Clear history?", body: "Your balance stays as it is.", confirmText: "Clear", destructive: true })) settings.store.history = [];
                    }}>Clear</Button>
                }
            >
                {history.map(e => <HistoryRow key={e.id} entry={e} />)}
            </Section>
        </>
    );
}

function HistoryRow({ entry }: { entry: HistoryEntry; }) {
    return (
        <Row
            leading={<UserAvatar userId={entry.userId} size={36} />}
            title={entry.kind === "gift" ? <>Gifted <b>{entry.item?.name}</b> to {entry.displayName}</> : <>Sent Robux to {entry.displayName}</>}
            subtitle={`@${entry.username} · ${fmtDate(entry.at)}`}
            trailing={<span className="vc-fakerobux-history-trailing"><Robux value={entry.amount} size={12} /><SimulatedTag /></span>}
            onClick={() => openReceipt(entry)}
            chevron
        />
    );
}

// ---------------------------------------------------------------- Window

type Tab = "profile" | "send" | "history";

function RobloxWindow({ close }: { close(): void; }) {
    const { username, balance, history } = settings.use(["username", "balance", "history"]);
    const [tab, setTab] = useState<Tab>("profile");

    return (
        <Sheet
            onClose={close}
            className={THEME}
            header={{
                title: "Roblox",
                subtitle: username ? `@${username}` : "Not connected",
                iconNode: <RobloxLogo />,
                actions: <span className="vc-fakerobux-header-balance" title={`${fmt(balance)} Robux`}><RobuxIcon size={18} />{abbr(balance)}</span>
            }}
            top={
                <Tabs<Tab>
                    value={tab}
                    options={[
                        { value: "profile", label: "Profile" },
                        { value: "send", label: "Send" },
                        { value: "history", label: "History", count: history.length || undefined }
                    ]}
                    onChange={setTab}
                />
            }
        >
            <ErrorBoundary noop>
                {tab === "profile" && <ProfileView />}
                {tab === "send" && <SendView />}
                {tab === "history" && <HistoryView />}
            </ErrorBoundary>
        </Sheet>
    );
}

export function openRobloxWindow() {
    openWindow(close => (
        <ErrorBoundary noop>
            <RobloxWindow close={close} />
        </ErrorBoundary>
    ), { size: "medium", className: classes(THEME, "vc-fakerobux-main") });
}

// ---------------------------------------------------------------- Settings

export const SettingsPanel = ErrorBoundary.wrap(() => {
    const { showTitleBarButton, history } = settings.use(["showTitleBarButton", "history"]);

    return (
        <Sheet embedded className={THEME} header={{ title: "Fake Robux", subtitle: "Roblox profile with a balance you choose", iconNode: <RobloxLogo /> }}>
            <Section title="Account" footer="Your public Roblox profile is shown. No login, nothing is changed on Roblox.">
                <AccountForm />
            </Section>
            <Section title="Robux balance" footer="Only shown here - your real Roblox balance doesn't change.">
                <BalanceEditor />
            </Section>
            <Section>
                <ToggleRow icon={ROBLOX_PATH} color={ICON_COLOR} title="Show icon in the title bar" checked={showTitleBarButton} onChange={v => settings.store.showTitleBarButton = v} />
                <Row title="Open Roblox window" leading={<span className="vc-fakerobux-robux-glyph"><Icon path={ROBUX_PATH} size={18} /></span>} onClick={openRobloxWindow} chevron />
                <Row
                    title="Clear history"
                    subtitle={`${history.length} simulated transactions`}
                    leading={<span className="vc-fakerobux-robux-glyph"><Icon path={GIFT_PATH} size={18} /></span>}
                    dim={!history.length}
                    onClick={history.length ? async () => {
                        if (await confirm({ title: "Clear history?", body: "Your balance stays as it is.", confirmText: "Clear", destructive: true })) settings.store.history = [];
                    } : undefined}
                />
            </Section>
        </Sheet>
    );
}, { noop: true });

// ---------------------------------------------------------------- Title bar

function TitleBarButton() {
    const { showTitleBarButton, balance } = settings.use(["showTitleBarButton", "balance"]);
    if (!showTitleBarButton) return null;

    return (
        <HeaderBarIcon
            className="vc-fakerobux-tb"
            onClick={openRobloxWindow}
            tooltip={`Roblox · ${abbr(balance)} Robux`}
            icon={() => <Icon path={ROBLOX_PATH} size={20} className={classes("vc-ui-tb-icon", "vc-fakerobux-tb-icon")} />}
        />
    );
}

export function renderTitleBarButton() {
    return (
        <ErrorBoundary key="vc-fakerobux-titlebar" noop>
            <TitleBarButton />
        </ErrorBoundary>
    );
}
