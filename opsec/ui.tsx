/*
 * OpSec – UI: title bar button, popout (Overview / Protection / Check),
 * settings (same UI in the plugin settings), link warning and scam blocklist status. Built with the shared _ui kit.
 * The curtain, panic key and streaming protection UI moved to PrivacyScreen.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { useForceUpdater } from "@utils/react";
import { findComponentByCodeLazy } from "@webpack";
import { ConnectedAccountsStore, Popout, React, Tooltip, useEffect, useMemo, useRef, UserSettingsProtoStore, UserStore, useState, useStateFromStores } from "@webpack/common";
import type { ReactNode } from "react";

import { AppIcon, Badge, Button, confirm, Glyph, Group, Icon, ICONS as UI_ICONS, notify, NotifyKind, Popover, Progress, Row, Section, Segmented, Sheet, Spinner, Stats, strokeIcon, ToggleRow, UiColor } from "../_ui";
import { Check, CHECKS, CheckStatus, getAuditSummary, loadConsents, onConsentsChange, runFix } from "./audit";
import { BLOCKLIST_SOURCE, getBlocklistStatus, onBlocklistChange, refreshBlocklist } from "./blocklist";
import { getConfig, setOption, setProfile, settings, UploadEditorMode } from "./index";
import type { LinkAnalysis } from "./links";
import { ConfigKey, Profile } from "./profiles";

const cl = classNameFactory("vc-opsec-");
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

/** App icon color of OpSec (window header, settings) */
export const OPSEC_COLOR: UiColor = "mint";

/** Plugin event notification (replaces Discord toasts); strips the old "OpSec: " prefix, the app name shows it */
export function opsecNotify(text: string, kind: NotifyKind = "success") {
    notify({ title: text.replace(/^OpSec: /, ""), kind, app: "OpSec" });
}

// ---------------------------------------------------------------- Icons

/** Circle as path data (for Lucide icons drawn with strokeIcon) */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

/** Crossed-out eye (Lucide eye-off) – OpSec's icon */
const MASK_PATH = strokeIcon(
    "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
    "M14.084 14.158a3 3 0 0 1-4.242-4.242",
    "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
    "m2 2 20 20"
);

const SHIELD = "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";

/** Lucide stroke icons */
const ICONS = {
    keyboard: strokeIcon("M10 8h.01", "M12 12h.01", "M14 8h.01", "M16 12h.01", "M18 8h.01", "M6 8h.01", "M7 16h10", "M8 12h.01", "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"),
    game: strokeIcon("M6 11h4", "M8 9v4", "M15 12h.01", "M18 10h.01", "M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"),
    eyeOff: MASK_PATH,
    photo: UI_ICONS.image,
    file: UI_ICONS.file,
    link: strokeIcon("M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"),
    warning: UI_ICONS.warning,
    wand: strokeIcon("m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72", "m14 7 3 3", "M5 6v4", "M19 14v4", "M10 2v2", "M7 8H3", "M21 16h-4", "M11 3H9"),
    shieldCheck: strokeIcon(SHIELD, "m9 12 2 2 4-4"),
    brush: strokeIcon("m11 10 3 3", "M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z", "M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031"),
    block: strokeIcon(circle(12, 12, 10), "m4.9 4.9 14.2 14.2"),
    restore: strokeIcon("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"),
    question: strokeIcon("M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01")
};

type IconName = keyof typeof ICONS;

export function MaskIcon({ size = 20, className }: { size?: number; className?: string; }) {
    return (
        <Icon path={MASK_PATH} size={size} className={classes(cl("icon"), className)} />
    );
}

// ---------------------------------------------------------------- Texts

const PROFILES: { value: Profile; label: string; description: string; }[] = [
    { value: "standard", label: "Standard", description: "Protects against tracking, IP loggers and metadata leaks without making Discord feel any different." },
    { value: "paranoid", label: "Paranoid", description: "Maximum stealth: invisible online and while typing, every link is confirmed and images are edited before upload." },
    { value: "custom", label: "Manual", description: "Configure everything yourself. Starts with the values of the previous profile." }
];

interface OptionInfo {
    key: ConfigKey;
    label: string;
    short: string;
    icon: IconName;
    color: UiColor;
    hint: string;
    hidden?: boolean;
}

const OPTIONS: Record<ConfigKey, OptionInfo> = {
    silentTyping: { key: "silentTyping", icon: "keyboard", color: "gray", label: "Type invisibly", short: "Invisible typing", hint: "Others don't see \"… is typing\". Otherwise it reveals that you're online and when you reply." },
    hideActivity: { key: "hideActivity", icon: "game", color: "purple", label: "Hide activity", short: "Hide activity", hint: "No \"Playing …\" / \"Listening to Spotify\". Otherwise it reveals habits and online times." },
    invisibleStatus: { key: "invisibleStatus", icon: "eyeOff", color: "indigo", label: "Status \"Invisible\"", short: "Invisible online", hint: "You appear offline but can use Discord completely normally." },
    dangerousLinkWarning: { key: "dangerousLinkWarning", icon: "warning", color: "orange", label: "Warn about dangerous links", short: "Link protection", hint: "Asks before IP loggers (Grabify & co.), phishing lookalikes (dlscord, steamcommunlty …) or punycode tricks are opened." },
    cleanSentLinks: { key: "cleanSentLinks", icon: "wand", color: "teal", label: "Remove tracking from sent links", short: "Clean links", hint: "Removes utm_, fbclid, YouTube/Spotify \"si\" etc. These reveal who shared the link." },
    cleanClickedLinks: { key: "cleanClickedLinks", icon: "link", color: "teal", label: "Remove tracking from clicked links", short: "Clean clicks", hint: "Links from others are opened without tracking parameters." },
    confirmExternalLinks: { key: "confirmExternalLinks", icon: "link", color: "blue", label: "Confirm every external link", short: "Confirm links", hint: "Every click reveals your IP address to the target site. This way you see exactly where it goes beforehand." },
    scamBlocklist: { key: "scamBlocklist", icon: "block", color: "red", label: "Scam blocklist (online)", short: "Scam blocklist", hint: "Over 35,000 known fake Nitro, Steam and phishing domains. Matches are marked red in chat and only opened after a warning. Only downloads the public list, sends nothing." },
    stripMetadata: { key: "stripMetadata", icon: "photo", color: "green", label: "Strip metadata from images & videos", short: "Strip metadata", hint: "GPS location, device, serial number, capture time, software … (JPEG, PNG, WebP, MP4, MOV). Lossless." },
    anonymizeFilenames: { key: "anonymizeFilenames", icon: "file", color: "blue", label: "Anonymize filenames", short: "Filenames", hint: "\"IMG_20260930_143022.jpg\" or \"Screenshot from Max-PC\" becomes a random name." },
    uploadEditor: { key: "uploadEditor", icon: "brush", color: "pink", label: "Edit images before sending", short: "Image editor", hint: "Crop, redact names & tokens, pixelate, arrows & text – before a screenshot goes out. PNG, JPEG, WebP." }
};

const TILES: ConfigKey[] = ["silentTyping", "hideActivity", "invisibleStatus", "stripMetadata", "dangerousLinkWarning", "cleanSentLinks", "uploadEditor", "cleanClickedLinks"];

type TabId = "overview" | "protection" | "check";

const TABS: { id: TabId; label: string; }[] = [
    { id: "overview", label: "Overview" },
    { id: "protection", label: "Protection" },
    { id: "check", label: "Check" }
];

// ---------------------------------------------------------------- Building blocks

/** Discord's own tooltip around any element (instead of the browser "title") */
export function Tip({ text, children }: { text: ReactNode; children: React.ReactElement<any>; }) {
    return (
        <Tooltip text={text}>
            {(tp: any) => {
                const own = children.props ?? {};
                const merged: Record<string, any> = { ...tp };
                for (const k of Object.keys(tp)) {
                    if (typeof tp[k] === "function" && typeof own[k] === "function") {
                        merged[k] = (e: any) => {
                            tp[k](e);
                            own[k](e);
                        };
                    }
                }
                return React.cloneElement(children, merged);
            }}
        </Tooltip>
    );
}

function OptGlyph({ name, color }: { name: IconName; color: UiColor; }) {
    return <Glyph path={ICONS[name]} color={color} />;
}

function useCountUp(target: number, duration = 700) {
    const [value, setValue] = useState(0);
    const from = useRef(0);
    useEffect(() => {
        const start = performance.now(), a = from.current;
        let raf = 0;
        const step = (t: number) => {
            const p = Math.min(1, (t - start) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            const v = Math.round(a + (target - a) * eased);
            setValue(v);
            from.current = v;
            if (p < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [target]);
    return value;
}

function ScoreRing({ ok, total, size = 76, stroke = 7 }: { ok: number; total: number; size?: number; stroke?: number; }) {
    const [shown, setShown] = useState(false);
    useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);
    const count = useCountUp(ok);

    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const pct = total ? ok / total : 0;
    const tone = pct >= 1 ? "good" : pct >= 0.7 ? "mid" : "bad";

    return (
        <div className={classes(cl("ring"), cl(`ring-${tone}`))} style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <circle cx={size / 2} cy={size / 2} r={r} className={cl("ring-track")} strokeWidth={stroke} />
                <circle
                    cx={size / 2} cy={size / 2} r={r}
                    className={cl("ring-bar")}
                    strokeWidth={stroke}
                    strokeDasharray={c}
                    strokeDashoffset={shown ? c * (1 - pct) : c}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
            </svg>
            <div className={cl("ring-label")}>
                <span className={cl("ring-num")}>{count}</span>
                <span className={cl("ring-total")}>/{total}</span>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- Security check

function safeStatus(c: Check): CheckStatus {
    try {
        return c.status();
    } catch {
        return "unknown";
    }
}

function useAudit() {
    const forceUpdate = useForceUpdater();
    useEffect(() => {
        loadConsents();
        return onConsentsChange(forceUpdate);
    }, []);
    useStateFromStores(
        [UserSettingsProtoStore, ConnectedAccountsStore, UserStore],
        () => CHECKS.map(safeStatus).join(",")
    );
    return { summary: getAuditSummary(), refresh: forceUpdate };
}

const STATUS_GLYPH: Record<CheckStatus, { path: string; color: UiColor; }> = {
    ok: { path: UI_ICONS.check, color: "green" },
    warn: { path: ICONS.warning, color: "orange" },
    unknown: { path: ICONS.question, color: "gray" }
};

function CheckRow({ check, onDone }: { check: Check; onDone(): void; }) {
    const [busy, setBusy] = useState(false);
    const status = safeStatus(check);

    const fix = async () => {
        setBusy(true);
        try {
            await runFix(check);
        } catch {
            opsecNotify(`OpSec: Failed to change "${check.title}"`, "error");
        } finally {
            setBusy(false);
            onDone();
        }
    };

    return (
        <Row
            align="top"
            leading={<Glyph path={STATUS_GLYPH[status].path} color={STATUS_GLYPH[status].color} />}
            title={<>{check.title}{status === "warn" && check.severity === "high" && <> <Badge color="red">Important</Badge></>}</>}
            subtitle={check.hint}
            trailing={status === "warn" && check.fix
                ? busy ? <Spinner /> : <Button small variant="tinted" onClick={fix}>{check.fixLabel ?? "Fix"}</Button>
                : undefined}
        />
    );
}

const AUTO_FIXABLE = (c: Check) => !!c.fix && c.id !== "mfa";

function CheckTab() {
    const { summary, refresh } = useAudit();
    const [busy, setBusy] = useState(false);
    const fixable = CHECKS.filter(c => AUTO_FIXABLE(c) && safeStatus(c) === "warn");
    const sorted = useMemo(() => {
        const order = { warn: 0, unknown: 1, ok: 2 } as const;
        const sev = { high: 0, medium: 1, low: 2 } as const;
        return [...CHECKS].sort((a, b) => order[safeStatus(a)] - order[safeStatus(b)] || sev[a.severity] - sev[b.severity]);
        // Only sort on open so rows don't jump after "Fix"
    }, []);

    const fixAll = async () => {
        setBusy(true);
        let failed = 0;
        for (const c of fixable) {
            try { await runFix(c); } catch { failed++; }
        }
        setBusy(false);
        refresh();
        opsecNotify(
            failed ? `OpSec: ${fixable.length - failed} fixed, ${failed} failed` : `OpSec: ${fixable.length} ${fixable.length === 1 ? "setting" : "settings"} secured`,
            failed ? "error" : "success"
        );
    };

    return (
        <>
            <Group className={cl("hero")}>
                <ScoreRing ok={summary.ok} total={summary.total} />
                <div className={cl("hero-text")}>
                    <span className={cl("hero-title")}>
                        {summary.warn ? `${summary.warn} ${summary.warn === 1 ? "recommendation" : "recommendations"} open` : "Everything secured"}
                    </span>
                    <span className={cl("hint")}>
                        {summary.highWarn ? `${summary.highWarn} of them important. ` : ""}Audits your account and Discord's privacy settings.
                    </span>
                    {fixable.length > 0 && (
                        <div>
                            <Button small icon={busy ? undefined : ICONS.shieldCheck} disabled={busy} onClick={fixAll}>
                                {busy ? "Securing…" : fixable.length === 1 ? "Fix" : `Fix all ${fixable.length}`}
                            </Button>
                        </div>
                    )}
                </div>
            </Group>
            <Section title="Checks">
                {sorted.map(c => <CheckRow key={c.id} check={c} onDone={refresh} />)}
            </Section>
        </>
    );
}

// ---------------------------------------------------------------- Overview

function ProfilePicker({ compact }: { compact?: boolean; }) {
    const { profile } = settings.use(["profile"]);
    const current = PROFILES.find(p => p.value === profile) ?? PROFILES[0];
    return (
        <Section title="Profile" footer={compact ? "Your original Discord settings are remembered and restored when turned off." : current.description} plain>
            <Segmented value={current.value} options={PROFILES} onChange={setProfile} />
        </Section>
    );
}

function Tile({ info, on }: { info: OptionInfo; on: boolean; }) {
    return (
        <Tip text={info.hint}>
            <button
                type="button"
                className={classes(cl("tile"), on && cl("tile-on"))}
                onClick={() => setOption(info.key, !on)}
                aria-pressed={on}
            >
                <Glyph path={ICONS[info.icon]} color={on ? info.color : "gray"} size={26} />
                <span className={cl("tile-text")}>
                    <span className={cl("tile-label")}>{info.short}</span>
                    <span className={cl("tile-state")}>{on ? "On" : "Off"}</span>
                </span>
            </button>
        </Tip>
    );
}

function StatusPanel({ goTo }: { goTo(t: TabId): void; }) {
    const { summary } = useAudit();
    const tone = summary.highWarn ? "bad" : summary.warn ? "warn" : "good";
    const color: UiColor = tone === "good" ? "green" : tone === "warn" ? "orange" : "red";
    const pct = summary.total ? Math.round((summary.ok / summary.total) * 100) : 0;

    return (
        <Section>
            <Row
                leading={<AppIcon path={tone === "good" ? ICONS.shieldCheck : ICONS.warning} color={color} size={40} />}
                title={tone === "good" ? "You are protected" : tone === "warn" ? "Almost fully protected" : "Action required"}
                subtitle={`${summary.ok} of ${summary.total} checks passed${summary.warn ? ` · ${summary.warn} open${summary.highWarn ? `, ${summary.highWarn} important` : ""}` : ""}`}
                trailing={<Button small variant={tone === "good" ? "gray" : "filled"} onClick={() => goTo("check")}>{tone === "good" ? "Details" : "Fix"}</Button>}
            >
                <div className={cl("meter")}><Progress value={pct / 100} color={color} /></div>
            </Row>
        </Section>
    );
}

function OverviewStats() {
    const { profile } = settings.use();
    const config = getConfig();
    const keys = TILES.filter(k => !OPTIONS[k].hidden);
    const active = keys.filter(k => config[k]).length;

    return (
        <Stats items={[
            { value: <>{active}<span className={cl("dim")}> / {keys.length}</span></>, label: "Modules active", color: "green" },
            { value: PROFILES.find(p => p.value === profile)?.label ?? "Standard", label: "Profile" }
        ]} />
    );
}

function OverviewTab({ goTo }: { goTo(t: TabId): void; }) {
    settings.use();
    const config = getConfig();

    return (
        <>
            <StatusPanel goTo={goTo} />
            <OverviewStats />
            <ProfilePicker />
            <Section title="Quick access" right={<Button small variant="plain" onClick={() => goTo("protection")}>All modules</Button>} plain>
                <div className={cl("tiles")}>
                    {TILES.filter(k => !OPTIONS[k].hidden).map(k => <Tile key={k} info={OPTIONS[k]} on={config[k]} />)}
                </div>
            </Section>
        </>
    );
}

// ---------------------------------------------------------------- Protection

const GROUPS: { title: string; keys: ConfigKey[]; }[] = [
    { title: "Stealth", keys: ["silentTyping", "hideActivity", "invisibleStatus"] },
    { title: "Links", keys: ["dangerousLinkWarning", "scamBlocklist", "cleanSentLinks", "cleanClickedLinks", "confirmExternalLinks"] },
    { title: "Files", keys: ["stripMetadata", "anonymizeFilenames", "uploadEditor"] }
];

const EDITOR_MODES: { value: UploadEditorMode; label: string; }[] = [
    { value: "ask", label: "Ask first" },
    { value: "always", label: "Always open" }
];

/** Indented option below a module (no glyph) */
function SubToggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange(v: boolean): void; label: ReactNode; hint?: ReactNode; disabled?: boolean; }) {
    return (
        <div className={cl("sub")}>
            <ToggleRow checked={checked} onChange={onChange} title={label} subtitle={hint} disabled={disabled} />
        </div>
    );
}

// ---------------------------------------------------------------- Scam blocklist

function useBlocklist() {
    const forceUpdate = useForceUpdater();
    useEffect(() => onBlocklistChange(forceUpdate), []);
    return getBlocklistStatus();
}

function formatAge(ts: number) {
    if (!ts) return "never";
    const min = Math.round((Date.now() - ts) / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 48) return `${h} hr ago`;
    return `${Math.round(h / 24)} days ago`;
}

function BlocklistStatus({ enabled }: { enabled: boolean; }) {
    const st = useBlocklist();
    const update = async () => {
        const ok = await refreshBlocklist(true);
        opsecNotify(ok ? `OpSec: Blocklist updated (${getBlocklistStatus().count.toLocaleString("en-US")} domains)` : "OpSec: Failed to load blocklist", ok ? "success" : "error");
    };

    return (
        <div className={cl("sub")}>
            <Row
                dim={!enabled}
                title={<>{st.count ? `${st.count.toLocaleString("en-US")} domains` : "Not loaded yet"}{st.failed && <> <Badge color="red">Error</Badge></>}</>}
                subtitle={`Updated ${formatAge(st.updated)} · Source: ${BLOCKLIST_SOURCE} · automatically every 12 hr`}
                trailing={
                    <Button small variant="gray" icon={st.loading ? undefined : ICONS.restore} disabled={!enabled || st.loading} onClick={update}>
                        {st.loading ? "Loading…" : "Update now"}
                    </Button>
                }
            />
        </div>
    );
}

function ProtectionTab() {
    const store = settings.use();
    const config = getConfig();

    const sub = (key: ConfigKey): ReactNode => {
        switch (key) {
            case "dangerousLinkWarning":
                return <>
                    <SubToggle disabled={!config.dangerousLinkWarning} checked={store.highlightIpLoggers} onChange={v => settings.store.highlightIpLoggers = v}
                        label="Mark IP loggers red in chat" />
                    <SubToggle disabled={!config.dangerousLinkWarning} checked={store.warnShorteners} onChange={v => settings.store.warnShorteners = v}
                        label="Also warn about short links" hint="bit.ly, tinyurl … the destination isn't visible before clicking." />
                </>;
            case "scamBlocklist":
                return <BlocklistStatus enabled={config.scamBlocklist} />;
            case "stripMetadata":
                return <SubToggle disabled={!config.stripMetadata} checked={store.showUploadToast} onChange={v => settings.store.showUploadToast = v}
                    label="Show what was removed" />;
            case "uploadEditor":
                return (
                    <div className={classes(cl("sub"), cl("pad"), !config.uploadEditor && cl("off"))}>
                        <Segmented small value={store.uploadEditorMode as UploadEditorMode} options={EDITOR_MODES} onChange={v => settings.store.uploadEditorMode = v} />
                        <span className={cl("hint")}>
                            {store.uploadEditorMode === "always" ? "Every image opens the editor before sending." : "Ask briefly before each image: \"Edit image?\""} Closing = send the original (metadata is still stripped).
                        </span>
                    </div>
                );
            case "anonymizeFilenames":
                return <SubToggle disabled={!config.anonymizeFilenames} checked={store.anonymizeAllFiles} onChange={v => settings.store.anonymizeAllFiles = v}
                    label="Also rename documents" hint="Otherwise PDFs, ZIPs etc. keep their name – which is usually important there." />;
        }
        return null;
    };

    return (
        <>
            <ProfilePicker compact />

            {GROUPS.map(g => {
                const keys = g.keys.filter(k => !OPTIONS[k].hidden);
                if (!keys.length) return null;
                return (
                    <Section key={g.title} title={g.title}>
                        {keys.map(k => (
                            <React.Fragment key={k}>
                                <ToggleRow leading={<OptGlyph name={OPTIONS[k].icon} color={OPTIONS[k].color} />} checked={config[k]} onChange={v => setOption(k, v)} title={OPTIONS[k].label} subtitle={OPTIONS[k].hint} />
                                {sub(k)}
                            </React.Fragment>
                        ))}
                    </Section>
                );
            })}

            <span className={cl("hint")}>The panic key, privacy curtain, capture protection and streaming protection are in the PrivacyScreen plugin.</span>
        </>
    );
}

// ---------------------------------------------------------------- Full UI

export function OpSecApp({ variant, close }: { variant: "popout" | "modal"; close?(): void; }) {
    const { lastTab } = settings.use(["lastTab"]);
    const { summary } = useAudit();
    const tab = (TABS.some(t => t.id === lastTab) ? lastTab : "overview") as TabId;
    const goTo = (t: TabId) => settings.store.lastTab = t;

    return (
        <Sheet
            className={classes(cl("app"), cl(`app-${variant}`), cl("no-intercept"), "vc-keep-motion")}
            embedded={variant === "modal"}
            height={variant === "popout" ? "min(640px, 76vh)" : undefined}
            onClose={close}
            header={{ app: "OpSec", title: "OpSec", subtitle: "Beneath the OS", icon: MASK_PATH, iconColor: OPSEC_COLOR }}
            top={
                <Segmented
                    value={tab}
                    options={TABS.map(t => ({ value: t.id, label: t.label, count: t.id === "check" ? summary.warn : undefined }))}
                    onChange={goTo}
                />
            }
        >
            <div key={tab} className={cl("pane")}>
                {tab === "overview" && <OverviewTab goTo={goTo} />}
                {tab === "protection" && <ProtectionTab />}
                {tab === "check" && <CheckTab />}
            </div>
        </Sheet>
    );
}

export const SettingsPanel = ErrorBoundary.wrap(() => <OpSecApp variant="modal" />, { noop: true });

// ---------------------------------------------------------------- Link warning

export async function showLinkWarning(url: string, analysis: LinkAnalysis, open: () => void) {
    const danger = analysis.risk === "danger";
    const warn = analysis.risk === "warn";

    const ok = await confirm({
        title: danger ? "Dangerous link" : warn ? "Be careful with this link" : "Open external link?",
        icon: danger || warn ? ICONS.warning : ICONS.link,
        iconColor: danger ? "red" : warn ? "orange" : "blue",
        body: (
            <div className={classes(cl("link-warning"), cl("no-intercept"), "vc-keep-motion")}>
                {analysis.reason
                    ? <div className={classes(cl("link-reason"), danger ? cl("link-danger") : cl("link-warn"))}>{analysis.reason}</div>
                    : <div className={cl("hint")}>The site learns your IP address when you open it.</div>}
                <div className={cl("link-host")}>{analysis.host || url}</div>
                <div className={cl("link-url")}>{url}</div>
            </div>
        ),
        confirmText: danger ? "Open anyway" : "Open",
        cancelText: "Cancel",
        destructive: danger
    });
    if (ok) open();
}

// ---------------------------------------------------------------- Title bar

function TitleBarButton() {
    const { profile } = settings.use(["profile"]);
    const buttonRef = useRef(null);
    const [show, setShow] = useState(false);

    return (
        <Popout
            position="bottom"
            align="left"
            animation={Popout.Animation.NONE}
            shouldShow={show}
            onRequestClose={() => setShow(false)}
            targetElementRef={buttonRef}
            renderPopout={() => (
                <ErrorBoundary noop>
                    <Popover width={440} className={classes(cl("popout"), "vc-keep-motion")}>
                        <OpSecApp variant="popout" close={() => setShow(false)} />
                    </Popover>
                </ErrorBoundary>
            )}
        >
            {(_, { isShown }) => (
                <HeaderBarIcon
                    ref={buttonRef}
                    className={classes(cl("btn-titlebar"), profile === "paranoid" && cl("btn-titlebar-hot"))}
                    onClick={() => setShow(v => !v)}
                    tooltip={isShown ? null : "OpSec"}
                    icon={() => <MaskIcon className="vc-ui-tb-icon" />}
                    selected={isShown}
                />
            )}
        </Popout>
    );
}

export function renderTitleBarButton() {
    return (
        <ErrorBoundary key="vc-opsec-titlebar" noop>
            <TitleBarButton />
        </ErrorBoundary>
    );
}
