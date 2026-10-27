/*
 * ServerDeclutter – shared UI building blocks (icons, number field, guild icon, job hook)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import { useEffect, useRef, useState } from "@webpack/common";

import { ICONS as UI_ICONS, strokeIcon, TextField } from "../_ui";
import { BulkProgress, CancelToken, createToken, releaseToken } from "./actions";

export const cl = classNameFactory("vc-serverdeclutter-");

export const ICON_COLOR = "teal";

// ---------------------------------------------------------------- Icons

export const ICONS = {
    ...UI_ICONS,
    // Lucide brush-cleaning
    broom: strokeIcon("m16 22-1-4", "M19 13.99a1 1 0 0 0 1-1V12a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v.99a1 1 0 0 0 1 1", "M5 14h14l1.973 6.767A1 1 0 0 1 20 22H4a1 1 0 0 1-.973-1.233z", "m8 22 1-4"),
    bellOff: strokeIcon("M10.268 21a2 2 0 0 0 3.464 0", "M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742", "m2 2 20 20", "M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05"),
    leave: UI_ICONS.leave,
    // Lucide square
    stop: strokeIcon("M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"),
    crown: strokeIcon("M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z", "M5 21h14"),
    // sort direction (Lucide chevron-up / chevron-down)
    arrowUp: strokeIcon("m18 15-6-6-6 6"),
    arrowDown: UI_ICONS.chevronDown
};

// ---------------------------------------------------------------- Building blocks

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
            {suffix && <span className={cl("muted")}>{suffix}</span>}
        </span>
    );
}

export function GuildIcon({ id, icon, name, size = 28 }: { id: string; icon: string | null; name: string; size?: number; }) {
    if (icon) {
        return <img className={cl("guild-icon")} width={size} height={size} src={`https://cdn.discordapp.com/icons/${id}/${icon}.webp?size=64`} alt="" loading="lazy" />;
    }
    const acronym = name.split(/\s+/).map(w => w[0] ?? "").join("").slice(0, 3);
    return <span className={cl("guild-icon")} style={{ width: size, height: size }}>{acronym}</span>;
}

// ---------------------------------------------------------------- Job hook

export interface LogEntry {
    id: number;
    kind: "ok" | "warn" | "error";
    text: string;
}

export interface JobState extends BulkProgress {
    running: boolean;
    title: string;
    log: LogEntry[];
}

let logId = 0;

/** A cancellable job with progress – it is cancelled when the window is closed */
export function useJob() {
    const [state, setState] = useState<JobState>({ running: false, title: "", done: 0, total: 0, label: "", log: [] });
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

    const log = (kind: LogEntry["kind"], text: string) =>
        update(s => ({ log: [...s.log, { id: ++logId, kind, text }].slice(-300) }));

    async function run<T>(title: string, total: number, fn: (token: CancelToken, hooks: { onProgress(p: BulkProgress): void; onLog: typeof log; }) => Promise<T>): Promise<T | null> {
        if (tokenRef.current) return null;
        const token = createToken();
        tokenRef.current = token;
        update({ running: true, title, done: 0, total, label: "Starting …", log: [] });
        try {
            return await fn(token, { onProgress: p => update(p), onLog: log });
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
        clearLog: () => update({ log: [] })
    };
}
