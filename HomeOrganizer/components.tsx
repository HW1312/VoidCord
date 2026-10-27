/*
 * HomeOrganizer – shared building blocks on top of the _ui kit (icons, checkbox, number field, job hook, confirmation)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { useEffect, useRef, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { Avatar, Badge, Button, Icon, ICONS as UI, openWindow, Progress, Row, Section, Sheet, strokeIcon, TextField, UiColor } from "../_ui";
import { CancelToken, createToken, describeError, isCancelled, onQueueChange, queueState, releaseToken } from "./queue";

export const cl = classNameFactory("vc-homeorganizer-");

export const APP_COLOR: UiColor = "teal";

// ---------------------------------------------------------------- Icons

/** Circle as path data (for Lucide icons drawn with strokeIcon) */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

export const ICONS = {
    home: strokeIcon("M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8", "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"),
    chat: strokeIcon("M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"),
    person: UI.user,
    personAdd: strokeIcon("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", circle(9, 7, 4), "M19 8v6", "M22 11h-6"),
    check: UI.check,
    close: UI.close,
    stop: strokeIcon("M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"),
    divider: strokeIcon("M5 12h14"),
    open: UI.external,
    shield: strokeIcon("M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"),
    pin: strokeIcon("M12 17v5", "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"),
    warning: UI.warning,
    moon: strokeIcon("M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"),
    refresh: UI.refresh,
    leave: UI.leave,
    group: strokeIcon("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", circle(9, 7, 4), "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75")
};

export const TONE_COLOR: Record<"info" | "warn" | "bad" | "good", UiColor> = { info: "blue", warn: "orange", bad: "red", good: "green" };

// ---------------------------------------------------------------- Building blocks

/** Selection check */
export function Check({ checked, onChange, disabled, title }: { checked: boolean; onChange(v: boolean): void; disabled?: boolean; title?: string; }) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            disabled={disabled}
            title={title}
            className={classes(cl("check"), checked && cl("check-on"))}
            onClick={e => {
                e.stopPropagation();
                onChange(!checked);
            }}
        >
            {checked && <Icon path={UI.check} size={12} />}
        </button>
    );
}

export function NumberField({ value, onChange, min, max, suffix }: { value: number; onChange(v: number): void; min: number; max: number; suffix?: string; }) {
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
            <TextField
                type="number"
                value={text}
                min={min}
                max={max}
                onChange={setText}
                onBlur={commit}
                onKeyDown={e => e.key === "Enter" && commit()}
            />
            {suffix && <span className={cl("dim")}>{suffix}</span>}
        </span>
    );
}

/** Queue status (waiting requests, rate limit) */
export function QueueBadge() {
    const [, setTick] = useState(0);
    useEffect(() => onQueueChange(() => setTick(t => t + 1)), []);
    useEffect(() => {
        const id = setInterval(() => queueState.pausedUntil > Date.now() && setTick(t => t + 1), 1000);
        return () => clearInterval(id);
    }, []);
    const pause = Math.ceil((queueState.pausedUntil - Date.now()) / 1000);
    if (pause > 0) return <Badge color="orange">Rate limited - waiting {pause}s</Badge>;
    if (queueState.pending > 0) return <Badge>{queueState.pending} in queue</Badge>;
    return null;
}

// ---------------------------------------------------------------- Job hook

export interface JobHooks {
    token: CancelToken;
    progress(done: number, total: number, label: string): void;
    onRateLimit(seconds: number): void;
}

export interface JobState {
    running: boolean;
    done: number;
    total: number;
    label: string;
    result: string | null;
}

/** A cancellable job with progress. It is cancelled when the window closes. */
export function useJob() {
    const [state, setState] = useState<JobState>({ running: false, done: 0, total: 0, label: "", result: null });
    const tokenRef = useRef<CancelToken | null>(null);
    const mounted = useRef(true);

    useEffect(() => () => {
        mounted.current = false;
        tokenRef.current?.cancel();
    }, []);

    const update = (patch: Partial<JobState>) => mounted.current && setState(s => ({ ...s, ...patch }));

    async function run(fn: (hooks: JobHooks) => Promise<string>) {
        if (tokenRef.current) return;
        const token = createToken();
        tokenRef.current = token;
        update({ running: true, done: 0, total: 0, label: "Starting ...", result: null });
        try {
            const result = await fn({
                token,
                progress: (done, total, label) => update({ done, total, label }),
                onRateLimit: s => update({ label: `Rate limited by Discord - waiting ${Math.ceil(s)} s ...` })
            });
            update({ result });
        } catch (e) {
            update({ result: isCancelled(e) ? "Cancelled." : `Error: ${describeError(e)}` });
        } finally {
            releaseToken(token);
            tokenRef.current = null;
            update({ running: false });
        }
    }

    return {
        state,
        run,
        cancel: () => tokenRef.current?.cancel(),
        clear: () => update({ result: null })
    };
}

export function JobBar({ job }: { job: ReturnType<typeof useJob>; }) {
    const { state } = job;
    if (!state.running && !state.result) return null;
    const pct = state.total > 0 ? Math.min(100, Math.round(state.done / state.total * 100)) : 0;
    return (
        <Section>
            <Row
                title={state.running ? state.label : state.result}
                subtitle={state.running && state.total > 0 ? `${state.done}/${state.total} · ${pct} %` : undefined}
                trailing={state.running
                    ? <Button small variant="destructive" icon={ICONS.stop} onClick={job.cancel}>Cancel</Button>
                    : <Button small variant="gray" onClick={job.clear}>OK</Button>}
            >
                {state.running && <div className={cl("job-progress")}><Progress value={pct} color={APP_COLOR} /></div>}
            </Row>
        </Section>
    );
}

// ---------------------------------------------------------------- Confirmation with preview

export interface ConfirmItem {
    id: string;
    name: string;
    avatar?: string;
    detail?: string;
}

/** Confirmation dialog with a list of the affected entries */
export function openConfirm({ title, text, items, confirmText, danger = true, onConfirm }: {
    title: string;
    text: ReactNode;
    items: ConfirmItem[];
    confirmText: string;
    danger?: boolean;
    onConfirm(): void;
}) {
    openWindow(close => (
        <Sheet
            header={{ title, icon: danger ? ICONS.warning : ICONS.home, iconColor: danger ? "red" : APP_COLOR }}
            onClose={close}
            actions={[
                { label: "Cancel", onClick: close },
                {
                    label: confirmText,
                    variant: danger ? "destructive" : "filled",
                    onClick: () => {
                        close();
                        onConfirm();
                    }
                }
            ]}
        >
            <ErrorBoundary>
                <div className={cl("confirm-text")}>{text}</div>
                {items.length > 0 && (
                    <Section>
                        {items.map(i => (
                            <Row key={i.id} leading={<Avatar src={i.avatar} size={24} />} title={i.name} trailing={i.detail && <span className={cl("dim")}>{i.detail}</span>} />
                        ))}
                    </Section>
                )}
            </ErrorBoundary>
        </Sheet>
    ), { size: "small" });
}


