/*
 * ServerTools – shared UI building blocks on top of the _ui kit (icons, progress, log, job hook)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import { classes } from "@utils/misc";
import { useEffect, useRef, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { Badge, Button as UiButton, Icon as UiIcon, ICONS as UI_ICONS, Note, Progress, Section, Segmented as UiSegmented, Spinner, strokeIcon, ToggleRow as UiToggleRow, UiColor } from "../_ui";
import type { JobHooks, LogKind } from "./backup";
import { CancelToken, createToken, describeError, isCancelled, onQueueChange, queueState, releaseToken } from "./queue";

export const cl = classNameFactory("vc-servertools-");

/** App icon color of ServerTools in the kit */
export const ICON_COLOR: UiColor = "orange";

// ---------------------------------------------------------------- Icons

/** Lucide rounded square (rect 3,3 18×18 rx 2) */
const SQUARE = "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z";

export const ICONS = {
    archive: strokeIcon("M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8", "M10 12h4"),
    // Lucide history
    restore: strokeIcon("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M12 7v5l4 2"),
    // Lucide activity
    pulse: strokeIcon("M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"),
    gift: strokeIcon("M4 8h16a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z", "M12 8v13", "M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7", "M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"),
    download: UI_ICONS.download,
    upload: strokeIcon("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m17 8-5-5-5 5", "M12 3v12"),
    warning: UI_ICONS.warning,
    check: UI_ICONS.check,
    close: UI_ICONS.close,
    // Lucide square
    stop: strokeIcon(SQUARE),
    play: UI_ICONS.play,
    copy: UI_ICONS.copy,
    send: strokeIcon("M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z", "m21.854 2.147-10.94 10.939"),
    // Lucide dice-5
    dice: strokeIcon(SQUARE, "M16 8h.01", "M8 8h.01", "M8 16h.01", "M16 16h.01", "M12 12h.01"),
    refresh: UI_ICONS.refresh,
    table: strokeIcon("M12 3v18", SQUARE, "M3 9h18", "M3 15h18"),
    shield: strokeIcon("M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"),
    // Lucide wrench
    tools: strokeIcon("M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z")
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string; }) {
    return <UiIcon path={ICONS[name]} size={size} className={classes(cl("icon"), className)} />;
}

// ---------------------------------------------------------------- Building blocks (thin wrappers around the kit)

const VARIANTS = {
    primary: { variant: "filled" },
    ghost: { variant: "gray" },
    danger: { variant: "destructive" },
    success: { variant: "filled", color: "green" }
} as const;

export function Button({ children, icon, variant = "primary", small, disabled, onClick, title }: {
    children?: ReactNode;
    icon?: IconName;
    variant?: keyof typeof VARIANTS;
    small?: boolean;
    disabled?: boolean;
    title?: string;
    onClick?(): void;
}) {
    const v = VARIANTS[variant];
    return (
        <UiButton variant={v.variant} color={"color" in v ? v.color : undefined} icon={icon && ICONS[icon]} small={small} disabled={disabled} onClick={onClick} title={title}>
            {children}
        </UiButton>
    );
}

/** Whole row clickable, switch on the right */
export function ToggleRow({ checked, onChange, label, hint, disabled, danger }: {
    checked: boolean;
    onChange(v: boolean): void;
    label: ReactNode;
    hint?: ReactNode;
    disabled?: boolean;
    danger?: boolean;
}) {
    return (
        <UiToggleRow
            title={danger ? <span className={cl("text-bad")}>{label}</span> : label}
            subtitle={hint}
            checked={checked}
            disabled={disabled}
            onChange={onChange}
        />
    );
}

/** Kit segmented control for number values */
export function Segmented<T extends string | number>({ value, options, onChange, disabled }: {
    value: T;
    options: { value: T; label: string; }[];
    onChange(v: T): void;
    disabled?: boolean;
}) {
    return (
        <div className={classes(cl("seg"), disabled && cl("disabled"))}>
            <UiSegmented
                value={String(value)}
                options={options.map(o => ({ value: String(o.value), label: o.label }))}
                onChange={v => !disabled && onChange(options.find(o => String(o.value) === v)!.value)}
            />
        </div>
    );
}

export function NumberField({ value, onChange, min, max, disabled, suffix }: {
    value: number;
    onChange(v: number): void;
    min: number;
    max: number;
    disabled?: boolean;
    suffix?: string;
}) {
    const [text, setText] = useState(String(value));
    useEffect(() => setText(String(value)), [value]);
    const commit = () => {
        const n = Math.round(Number(text));
        const clamped = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value;
        setText(String(clamped));
        if (clamped !== value) onChange(clamped);
    };
    return (
        <span className={cl("number")}>
            <input
                type="number"
                className={classes("vc-ui-field", cl("number-input"))}
                value={text}
                min={min}
                max={max}
                disabled={disabled}
                onChange={e => setText(e.currentTarget.value)}
                onBlur={commit}
                onKeyDown={e => e.key === "Enter" && commit()}
            />
            {suffix && <span className={cl("muted")}>{suffix}</span>}
        </span>
    );
}

/** Kit section whose group holds free content (padded) and kit rows (full width) */
export function Card({ title, right, children }: { title?: ReactNode; right?: ReactNode; children: ReactNode; }) {
    return (
        <Section title={title} right={right}>
            <div className={cl("card-body")}>{children}</div>
        </Section>
    );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger"; children: ReactNode; }) {
    return <Note tone={tone === "info" ? undefined : tone === "warn" ? "warn" : "bad"}>{children}</Note>;
}

// ---------------------------------------------------------------- Progress & log

export function ProgressBar({ done, total, label, indeterminate }: { done: number; total: number; label?: ReactNode; indeterminate?: boolean; }) {
    const pct = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
    return (
        <div className={cl("progress")}>
            <div className={cl("progress-head")}>
                {indeterminate && <Spinner />}
                <span className={cl("progress-label")}>{label}</span>
                {!indeterminate && total > 0 && <span className={cl("muted")}>{pct} %</span>}
            </div>
            {!indeterminate && <Progress value={pct} />}
        </div>
    );
}

export interface LogEntry {
    id: number;
    kind: LogKind;
    text: string;
    time: number;
}

export function LogList({ entries }: { entries: LogEntry[]; }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    }, [entries.length]);
    if (!entries.length) return null;
    return (
        <div className={cl("log")} ref={ref}>
            {entries.map(e => (
                <div key={e.id} className={classes(cl("log-row"), cl(`log-${e.kind}`))}>
                    <span className={cl("log-time")}>{new Date(e.time).toLocaleTimeString()}</span>
                    <span>{e.text}</span>
                </div>
            ))}
        </div>
    );
}

/** Queue status (pending requests, rate limit) */
export function QueueBadge() {
    const [, setTick] = useState(0);
    useEffect(() => onQueueChange(() => setTick(t => t + 1)), []);
    useEffect(() => {
        const id = setInterval(() => queueState.pausedUntil > Date.now() && setTick(t => t + 1), 1000);
        return () => clearInterval(id);
    }, []);
    const pause = Math.ceil((queueState.pausedUntil - Date.now()) / 1000);
    if (pause > 0) return <Badge color="orange">Rate limit - waiting {pause}s</Badge>;
    if (queueState.pending > 0) return <Badge>{queueState.pending} in queue</Badge>;
    return null;
}

// ---------------------------------------------------------------- Job hook

export interface JobState {
    running: boolean;
    done: number;
    total: number;
    label: string;
    log: LogEntry[];
}

let logId = 0;

/**
 * Manages a cancellable job with progress & log.
 * When the window is closed, a running job is cancelled automatically.
 */
export function useJob() {
    const [state, setState] = useState<JobState>({ running: false, done: 0, total: 0, label: "", log: [] });
    const tokenRef = useRef<CancelToken | null>(null);
    const mounted = useRef(true);

    useEffect(() => () => {
        mounted.current = false;
        tokenRef.current?.cancel();
    }, []);

    const update = (patch: Partial<JobState> | ((s: JobState) => Partial<JobState>)) => {
        if (!mounted.current) return;
        setState(s => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }));
    };

    const log = (kind: LogKind, text: string) => update(s => ({ log: [...s.log, { id: ++logId, kind, text, time: Date.now() }].slice(-400) }));

    async function run<T>(fn: (hooks: JobHooks) => Promise<T>, { keepLog = false } = {}): Promise<T | null> {
        if (tokenRef.current) return null;
        const token = createToken();
        tokenRef.current = token;
        update(s => ({ running: true, done: 0, total: 0, label: "Starting …", log: keepLog ? s.log : [] }));
        const hooks: JobHooks = {
            token,
            log,
            onProgress: (done, total, label) => update({ done, total, label }),
            onRateLimit: seconds => log("warn", `Rate limited by Discord - waiting ${Math.ceil(seconds)} s`)
        };
        try {
            return await fn(hooks);
        } catch (e) {
            if (isCancelled(e)) log("warn", "Cancelled");
            else log("error", describeError(e));
            throw e;
        } finally {
            releaseToken(token);
            tokenRef.current = null;
            update({ running: false });
        }
    }

    return {
        state,
        run,
        log,
        cancel: () => tokenRef.current?.cancel(),
        clearLog: () => update({ log: [] })
    };
}
