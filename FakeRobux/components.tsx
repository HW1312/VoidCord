/*
 * FakeRobux – icons and small shared parts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { Avatar, classes, Icon } from "../_ui";
import { avatar, CatalogItem, image } from "./api";

// ---------------------------------------------------------------- Icons (24×24 paths)

/** Robux: hexagon ring with a square in the middle */
export const ROBUX_PATH = "M12 1.6 21 6.8V17.2L12 22.4 3 17.2V6.8ZM12 4.4 5.4 8.2V15.8L12 19.6 18.6 15.8V8.2ZM9.2 9.2H14.8V14.8H9.2Z";
/** Roblox logo: tilted square with a square hole */
export const ROBLOX_PATH = "M6.34 2.2 21.8 6.34 17.66 21.8 2.2 17.66ZM10.41 9.24 9.24 13.59 13.59 14.76 14.76 10.41Z";
export const VERIFIED_PATH = "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.9-4.9 1.4 1.4-6.3 6.3Z";
export const GIFT_PATH = "M20 7h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h7V7h2v5h7a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1ZM9 7a1 1 0 1 1 1-1v1H9Zm6 0h-1V6a1 1 0 1 1 1 1ZM4 14v6a1 1 0 0 0 1 1h6v-7H4Zm9 7h6a1 1 0 0 0 1-1v-6h-7v7Z";
export const SEND_PATH = "M3.4 20.4 21.85 12.4a.5.5 0 0 0 0-.9L3.4 3.6a.5.5 0 0 0-.7.6L5 11h8v2H5l-2.3 6.8a.5.5 0 0 0 .7.6Z";
export const HISTORY_PATH = "M13 3a9 9 0 0 0-9 9H1l3.9 3.9.1.1L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3Zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12Z";
export const PERSON_PATH = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z";

/** Scope class: everything inside is drawn in Roblox's own look (see roblox.css) */
export const THEME = "vc-fakerobux-rbx";

// ---------------------------------------------------------------- Formatting

export const fmt = (n: number) => Math.floor(n).toLocaleString("en-US");

/** Like Roblox's top bar: 12.3K+, 4.5M+ */
export function abbr(n: number) {
    if (n < 10_000) return fmt(n);
    const units: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
    for (const [v, s] of units) if (n >= v) return `${Math.floor(n / v * 10) / 10}${s}+`;
    return fmt(n);
}

export const fmtDate = (d: string | number | Date) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// ---------------------------------------------------------------- Hooks

export interface AsyncState<T> { value?: T; error?: string; loading: boolean; }

/** Runs fn whenever deps change; ignores results of outdated runs */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
    const [state, setState] = useState<AsyncState<T>>({ loading: true });
    useEffect(() => {
        let alive = true;
        setState(s => ({ value: s.value, loading: true }));
        fn().then(
            value => alive && setState({ value, loading: false }),
            e => alive && setState({ error: String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), loading: false })
        );
        return () => { alive = false; };
    }, deps);
    return state;
}

// ---------------------------------------------------------------- Parts

export function RobuxIcon({ size = 16, className }: { size?: number; className?: string; }) {
    return <Icon path={ROBUX_PATH} size={size} className={classes("vc-fakerobux-robux-icon", className)} />;
}

export function Robux({ value, size = 14, className }: { value: number; size?: number; className?: string; }) {
    return (
        <span className={classes("vc-fakerobux-robux", className)}>
            <RobuxIcon size={size} />
            {fmt(value)}
        </span>
    );
}

export function Verified({ size = 14 }: { size?: number; }) {
    return <span className="vc-fakerobux-verified" title="Verified"><Icon path={VERIFIED_PATH} size={size} /></span>;
}

export function UserAvatar({ userId, size = 40, kind = "headshot" }: { userId: number; size?: number; kind?: "headshot" | "body"; }) {
    const { value } = useAsync(() => avatar(userId, kind), [userId, kind]);
    return <Avatar src={value ?? undefined} size={size} fallback={PERSON_PATH} />;
}

/** Display name with verified tick + @username below */
export function UserName({ displayName, name, verified }: { displayName: string; name: string; verified: boolean; }) {
    return (
        <span className="vc-fakerobux-name">
            <span className="vc-fakerobux-display">{displayName}{verified && <Verified />}</span>
            <span className="vc-fakerobux-handle">@{name}</span>
        </span>
    );
}

export function ItemThumb({ url, size = 64, item }: { url?: string; size?: number; item?: CatalogItem; }) {
    const { value } = useAsync(() => image(url), [url]);
    return (
        <span className="vc-fakerobux-thumb" style={{ width: size, height: size }} title={item?.name}>
            {value ? <img src={value} alt="" width={size} height={size} draggable={false} /> : <Icon path={GIFT_PATH} size={Math.round(size * 0.4)} />}
        </span>
    );
}

/** Roblox-style tab bar: text tabs with a blue underline on the active one */
export function Tabs<T extends string>({ value, options, onChange }: {
    value: T;
    options: { value: T; label: ReactNode; count?: number; }[];
    onChange(v: T): void;
}) {
    return (
        <div className="vc-fakerobux-tabs" role="tablist">
            {options.map(o => (
                <button
                    key={o.value}
                    type="button"
                    role="tab"
                    aria-selected={o.value === value}
                    className={classes("vc-fakerobux-tab", o.value === value && "vc-fakerobux-tab-on")}
                    onClick={() => onChange(o.value)}
                >
                    {o.label}
                    {!!o.count && <span className="vc-fakerobux-tab-count">{o.count}</span>}
                </button>
            ))}
        </div>
    );
}

/** Roblox logo for window headers */
export function RobloxLogo({ size = 30 }: { size?: number; }) {
    return <span className="vc-fakerobux-logo"><Icon path={ROBLOX_PATH} size={size} /></span>;
}

/** Fixed marker on everything that looks like a transaction */
export function SimulatedTag() {
    return <span className="vc-fakerobux-sim-tag">Simulated</span>;
}
