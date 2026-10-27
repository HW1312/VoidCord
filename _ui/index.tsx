/*
 * _ui – shared "Void" UI kit for all own plugins (flat, near-black, hairlines – like the VOID dashboard).
 * Not a plugin itself (folders starting with "_" are skipped by Vencord); build.mjs copies it next to the plugins,
 * they import it with `from "../_ui"`.
 *
 * Colors live in CSS variables (--vc-ui-*) on :root (always dark), so they can be used in any
 * plugin's CSS as well, e.g. small chips inside the chat.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./fonts.generated.css";
import "./ui.css";

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { ModalRoot, ModalSize } from "@utils/modal";
import { createRoot, openModal, ReactDOM, Tooltip, useEffect, useRef, useState } from "@webpack/common";
import type { CSSProperties, ReactNode } from "react";

import { APP_GLYPHS } from "./appGlyphs";

export const cl = classNameFactory("vc-ui-");
export { classes };

// ---------------------------------------------------------------- Icons

/** Paths drawn as thin strokes (Lucide style) instead of filled shapes */
const STROKE = new Set<string>();

/** Circle as a path, so every icon part is path data */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

/**
 * Registers a stroke icon (Lucide, 24×24, 2px grid) and returns its path for `<Icon path>` / `icon` props.
 * Plain path strings that were not registered are still drawn filled (old plugin icons keep working).
 */
export function strokeIcon(...parts: string[]) {
    // Parts stay separate <path>s (a joined "m…" would turn relative); "|" never occurs in path data
    const d = parts.join("|");
    STROKE.add(d);
    return d;
}

/** Common icons (Lucide), so plugins don't each carry their own copy */
export const ICONS = {
    close: strokeIcon("M18 6 6 18", "m6 6 12 12"),
    check: strokeIcon("M20 6 9 17l-5-5"),
    chevron: strokeIcon("m9 18 6-6-6-6"),
    chevronDown: strokeIcon("m6 9 6 6 6-6"),
    back: strokeIcon("m15 18-6-6 6-6"),
    plus: strokeIcon("M5 12h14", "M12 5v14"),
    search: strokeIcon(circle(11, 11, 8), "m21 21-4.3-4.3"),
    refresh: strokeIcon("M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"),
    gear: strokeIcon(
        "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
        circle(12, 12, 3)
    ),
    trash: strokeIcon("M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", "M10 11v6", "M14 11v6"),
    edit: strokeIcon("M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4"),
    info: strokeIcon(circle(12, 12, 10), "M12 16v-4", "M12 8h.01"),
    warning: strokeIcon("m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", circle(12, 17, 0.4)),
    bell: strokeIcon("M10.268 21a2 2 0 0 0 3.464 0", "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"),
    download: strokeIcon("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"),
    external: strokeIcon("M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"),
    copy: strokeIcon("M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z", "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"),
    user: strokeIcon("M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", circle(12, 7, 4)),
    folder: strokeIcon("M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"),
    play: strokeIcon("M6 3 20 12 6 21Z"),
    // door frame, arrow head, arrow shaft (the arrow parts are animated in leave buttons)
    leave: strokeIcon("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"),
    arrowRight: strokeIcon("M5 12h14", "m12 5 7 7-7 7"),
    checkAll: strokeIcon("M18 6 7 17l-5-5", "m22 10-7.5 7.5L13 16"),
    // face, hands (the hands turn in clock buttons)
    clock: strokeIcon(circle(12, 12, 10), "M12 6v6l4 2"),
    bookmark: strokeIcon("m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"),
    inbox: strokeIcon("M22 12h-6l-2 3h-4l-2-3H2", "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"),
    image: strokeIcon("M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", circle(9, 9, 2), "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"),
    file: strokeIcon("M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M10 9H8", "M16 13H8", "M16 17H8"),
    zap: strokeIcon("M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"),
    music: strokeIcon(circle(8, 18, 4), "M12 18V2l7 4"),
    hash: strokeIcon("M4 9h16", "M4 15h16", "M10 3 8 21", "M16 3l-2 18"),
    server: strokeIcon("M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z", "M6 6h.01", "M6 18h.01"),
    sliders: strokeIcon("M21 4h-7", "M10 4H3", "M21 12h-9", "M8 12H3", "M21 20h-5", "M12 20H3", "M14 2v4", "M8 10v4", "M16 18v4")
} as const;

export function Icon({ path, size = 16, className, style }: { path: string; size?: number; className?: string; style?: CSSProperties; }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} className={className} style={style} aria-hidden>
            {STROKE.has(path)
                ? <g fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                    {path.split("|").map(d => <path key={d} d={d} />)}
                </g>
                : <path fill="currentColor" d={path} />}
        </svg>
    );
}

// ---------------------------------------------------------------- Colors

/** accent = the neutral (white) main color; the rest are data / status colors */
export type UiColor = "accent" | "blue" | "green" | "orange" | "red" | "purple" | "indigo" | "teal" | "yellow" | "pink" | "gray" | "mint";

/** Big rounded app icon, e.g. in a window header */
export function AppIcon({ path, color = "blue", size = 42, children }: { path?: string; color?: UiColor; size?: number; children?: ReactNode; }) {
    return (
        <span className={classes(cl("app-icon"), cl(`fill-${color}`))} style={{ width: size, height: size, borderRadius: size * 0.26 }}>
            {children ?? (path && <Icon path={path} size={Math.round(size * 0.52)} />)}
        </span>
    );
}

/** Small colored square in front of a settings row (like iOS Settings) */
export function Glyph({ path, color = "blue", size = 28 }: { path: string; color?: UiColor; size?: number; }) {
    return (
        <span className={classes(cl("glyph"), cl(`fill-${color}`))} style={{ width: size, height: size, borderRadius: size * 0.25 }}>
            <Icon path={path} size={Math.round(size * 0.58)} />
        </span>
    );
}

// ---------------------------------------------------------------- Controls

/** iOS switch */
export function Toggle({ checked, onChange, label, disabled, color }: {
    checked: boolean; onChange(v: boolean): void; label?: string; disabled?: boolean; color?: UiColor;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            className={classes(cl("toggle"), checked && cl("toggle-on"))}
            style={checked && color ? { background: `var(--vc-ui-${color})` } : undefined}
            onClick={e => { e.preventDefault(); e.stopPropagation(); if (!disabled) onChange(!checked); }}
        >
            <span className={cl("toggle-knob")} />
        </button>
    );
}

export interface SegmentOption<T extends string> { value: T; label: ReactNode; count?: number; }

/** iOS segmented control with a sliding thumb. A value that matches no option shows nothing selected. */
export function Segmented<T extends string>({ value, options, onChange, small }: {
    value: T | null; options: SegmentOption<T>[]; onChange(v: T): void; small?: boolean;
}) {
    const index = options.findIndex(o => o.value === value);
    return (
        <div className={classes(cl("segmented"), small && cl("segmented-small"))} style={{ "--vc-ui-seg": Math.max(0, index), "--vc-ui-segs": options.length } as CSSProperties} role="tablist">
            {index !== -1 && <span className={cl("segmented-thumb")} />}
            {options.map(o => (
                <button
                    key={o.value}
                    type="button"
                    role="tab"
                    aria-selected={o.value === value}
                    className={classes(cl("segment"), o.value === value && cl("segment-on"))}
                    onClick={() => onChange(o.value)}
                >
                    {o.label}
                    {!!o.count && <span className={cl("segment-count")}>{o.count > 999 ? "999+" : o.count}</span>}
                </button>
            ))}
        </div>
    );
}

export type ButtonVariant = "filled" | "tinted" | "gray" | "plain" | "destructive";

/**
 * Every button with an icon animates it on hover and click (CSS, classes vc-ui-ia-<name>).
 * Kit icons have their own motion, any other icon gets the generic "pop". ms = length of the click animation.
 */
const ICON_ANIMS = new Map<string, { name: string; ms: number; }>([
    [ICONS.trash, { name: "trash", ms: 600 }],
    [ICONS.leave, { name: "leave", ms: 480 }],
    [ICONS.close, { name: "close", ms: 380 }],
    [ICONS.plus, { name: "plus", ms: 380 }],
    [ICONS.check, { name: "check", ms: 450 }],
    [ICONS.chevron, { name: "chevron", ms: 380 }],
    [ICONS.back, { name: "back", ms: 380 }],
    [ICONS.search, { name: "search", ms: 450 }],
    [ICONS.refresh, { name: "refresh", ms: 600 }],
    [ICONS.gear, { name: "gear", ms: 600 }],
    [ICONS.edit, { name: "edit", ms: 450 }],
    [ICONS.info, { name: "shake", ms: 420 }],
    [ICONS.warning, { name: "shake", ms: 420 }],
    [ICONS.bell, { name: "bell", ms: 600 }],
    [ICONS.download, { name: "download", ms: 500 }],
    [ICONS.external, { name: "external", ms: 450 }],
    [ICONS.copy, { name: "copy", ms: 420 }],
    [ICONS.user, { name: "pop", ms: 350 }],
    [ICONS.folder, { name: "pop", ms: 350 }],
    [ICONS.play, { name: "play", ms: 400 }],
    [ICONS.arrowRight, { name: "chevron", ms: 380 }],
    [ICONS.checkAll, { name: "check", ms: 450 }],
    [ICONS.clock, { name: "clock", ms: 600 }],
    [ICONS.bookmark, { name: "bookmark", ms: 450 }],
    [ICONS.zap, { name: "zap", ms: 420 }],
    [ICONS.sliders, { name: "sliders", ms: 500 }]
]);

const POP = { name: "pop", ms: 350 };
const iconAnim = (icon: string) => ICON_ANIMS.get(icon) ?? POP;

/** Classes for a button whose icon animates */
const animClasses = (icon: string | undefined) => icon && classes(cl("ia"), cl(`ia-${iconAnim(icon).name}`));

/** Restarts the click animation (re-adding the class replays it on every click) */
function playHit(el: HTMLElement) {
    el.classList.remove(cl("ia-hit"));
    void el.offsetWidth;
    el.classList.add(cl("ia-hit"));
}

/** Copy buttons confirm the click: the icon turns into a green check for a moment. Returns the icon to show. */
function useCopyFeedback(icon: string | undefined) {
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    const trigger = () => {
        if (icon !== ICONS.copy) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
    };
    return { shown: copied ? ICONS.check : icon, copied, trigger };
}

/** Button. filled = main action (white), gray/tinted = secondary, plain = text only, destructive = red outline */
export function Button({ children, onClick, variant = "filled", color = "accent", icon, small, disabled, wide, title }: {
    children?: ReactNode; onClick?(e: React.MouseEvent): void; variant?: ButtonVariant; color?: UiColor;
    icon?: string; small?: boolean; disabled?: boolean; wide?: boolean; title?: string;
}) {
    const tone = variant === "destructive" ? "red" : color;
    const copy = useCopyFeedback(icon);
    return (
        <button
            type="button"
            title={title}
            disabled={disabled}
            className={classes(cl("btn"), cl(`btn-${variant}`), small && cl("btn-small"), wide && cl("btn-wide"), !children && cl("btn-icon-only"), animClasses(icon), copy.copied && cl("ia-copied"))}
            style={{ "--vc-ui-tone": `var(--vc-ui-${tone})` } as CSSProperties}
            onClick={icon ? e => { playHit(e.currentTarget); copy.trigger(); onClick?.(e); } : onClick}
        >
            {/* keyed, so the swapped icon mounts fresh and plays its entrance */}
            {copy.shown && <Icon key={copy.shown} path={copy.shown} size={small ? 14 : 16} />}
            {children != null && <span>{copy.copied && children === "Copy" ? "Copied" : children}</span>}
        </button>
    );
}

/** Round gray icon button (refresh, close, more …) with a tooltip */
export function RoundButton({ icon, label, onClick, disabled, size = 30, active, className }: {
    icon: string; label: string; onClick(e: React.MouseEvent): void; disabled?: boolean; size?: number; active?: boolean; className?: string;
}) {
    const copy = useCopyFeedback(icon);
    return (
        <Tooltip text={copy.copied ? "Copied" : label}>
            {(tip: any) => (
                <button
                    {...tip}
                    type="button"
                    aria-label={label}
                    disabled={disabled}
                    className={classes(cl("round-btn"), active && cl("round-btn-active"), animClasses(icon), copy.copied && cl("ia-copied"), className)}
                    style={{ width: size, height: size }}
                    onClick={e => { e.stopPropagation(); playHit(e.currentTarget); copy.trigger(); onClick(e); }}
                >
                    <Icon key={copy.shown} path={copy.shown!} size={Math.round(size * 0.5)} />
                </button>
            )}
        </Tooltip>
    );
}

/** Small icon button for row actions; red when destructive */
export function IconButton({ icon, label, onClick, destructive, disabled, active }: {
    icon: string; label: string; onClick(e: React.MouseEvent): void; destructive?: boolean; disabled?: boolean; active?: boolean;
}) {
    const copy = useCopyFeedback(icon);
    return (
        <Tooltip text={copy.copied ? "Copied" : label}>
            {(tip: any) => (
                <button
                    {...tip}
                    type="button"
                    aria-label={label}
                    disabled={disabled}
                    className={classes(cl("icon-btn"), destructive && cl("icon-btn-destructive"), active && cl("icon-btn-active"), animClasses(icon), copy.copied && cl("ia-copied"))}
                    onClick={e => { e.stopPropagation(); playHit(e.currentTarget); copy.trigger(); onClick(e); }}
                >
                    <Icon key={copy.shown} path={copy.shown!} size={16} />
                </button>
            )}
        </Tooltip>
    );
}

/** iOS activity indicator */
export function Spinner({ size = 14 }: { size?: number; }) {
    return (
        <span className={cl("spinner")} style={{ width: size, height: size, "--vc-ui-spin-size": `${size}px` } as CSSProperties} aria-hidden>
            {Array.from({ length: 8 }, (_, i) => <i key={i} style={{ transform: `rotate(${i * 45}deg)`, animationDelay: `${(i - 8) * 0.1}s` }} />)}
        </span>
    );
}

export function Progress({ value, color = "accent" }: { value: number; color?: UiColor; }) {
    return (
        <div className={cl("progress")}>
            <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: `var(--vc-ui-${color})` }} />
        </div>
    );
}

/** Small rounded label, e.g. "NEW", "3 left". Clickable when onClick is given. */
export function Badge({ children, color = "gray", solid, icon, title, onClick }: {
    children?: ReactNode; color?: UiColor; solid?: boolean; icon?: string; title?: string; onClick?(e: React.MouseEvent): void;
}) {
    const Tag = onClick ? "button" : "span";
    return (
        <Tag
            type={onClick ? "button" : undefined}
            title={title}
            className={classes(cl("badge"), solid && cl("badge-solid"), onClick && cl("badge-click"))}
            style={{ "--vc-ui-tone": `var(--vc-ui-${color})` } as CSSProperties}
            onClick={onClick ? (e: React.MouseEvent) => { e.stopPropagation(); onClick(e); } : undefined}
        >
            {icon && <Icon path={icon} size={11} />}
            {children != null && <span className={cl("badge-label")}>{children}</span>}
        </Tag>
    );
}

/** Rounded filter / choice pill (tags, quick picks). With onRemove it shows a small × (removable chip). */
export function Pill({ children, selected, onClick, onRemove, icon, leading, title }: {
    children: ReactNode; selected?: boolean; onClick?(e: React.MouseEvent): void; onRemove?(): void; icon?: string; leading?: ReactNode; title?: string;
}) {
    return (
        <span
            className={classes(cl("pill"), selected && cl("pill-on"), onClick && cl("pill-click"))}
            title={title}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onClick={onClick ? e => { e.stopPropagation(); onClick(e); } : undefined}
            onKeyDown={onClick ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e as any); } } : undefined}
        >
            {leading}
            {icon && <Icon path={icon} size={12} />}
            <span className={cl("pill-label")}>{children}</span>
            {onRemove && (
                <button type="button" className={cl("pill-x")} aria-label="Remove" onClick={e => { e.stopPropagation(); onRemove(); }}>
                    <Icon path={ICONS.close} size={9} />
                </button>
            )}
        </span>
    );
}

/** Wrapping row of pills */
export function Pills({ children }: { children: ReactNode; }) {
    return <div className={cl("pills")}>{children}</div>;
}

/** Slider with the value shown at the right */
export function Slider({ value, onChange, min = 0, max = 100, step = 1, format }: {
    value: number; onChange(v: number): void; min?: number; max?: number; step?: number; format?(v: number): ReactNode;
}) {
    const pct = (value - min) / (max - min || 1) * 100;
    return (
        <span className={cl("slider")}>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                style={{ "--vc-ui-fill": `${pct}%` } as CSSProperties}
                onChange={e => onChange(Number(e.currentTarget.value))}
            />
            {format && <span className={cl("slider-value")}>{format(value)}</span>}
        </span>
    );
}

/** Colored status text with an optional check / spinner, for the right side of rows */
export function State({ children, tone, spinner, check }: { children: ReactNode; tone?: "ok" | "warn" | "bad"; spinner?: boolean; check?: boolean; }) {
    return (
        <span className={classes(cl("state"), tone && cl(`state-${tone}`))}>
            {spinner && <Spinner />}
            {check && <span className={cl("check")}><Icon path={ICONS.check} size={11} /></span>}
            {children}
        </span>
    );
}

// ---------------------------------------------------------------- Text fields

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & { value: string | number; onChange(v: string): void; };

export function SearchField({ value, onChange, placeholder = "Search", className, ...rest }: InputProps & { value: string; }) {
    return (
        <label className={classes(cl("search"), className)}>
            <Icon path={ICONS.search} size={15} />
            <input {...rest} value={value} placeholder={placeholder} onChange={e => onChange(e.currentTarget.value)} />
            {value && (
                <button type="button" className={cl("search-clear")} aria-label="Clear" onClick={() => onChange("")}>
                    <Icon path={ICONS.close} size={10} />
                </button>
            )}
        </label>
    );
}

export function TextField({ value, onChange, className, ...rest }: InputProps) {
    return <input {...rest} className={classes(cl("field"), className)} value={value} onChange={e => onChange(e.currentTarget.value)} />;
}

type AreaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & { value: string; onChange(v: string): void; };

export function TextArea({ value, onChange, className, ...rest }: AreaProps) {
    return <textarea {...rest} className={classes(cl("field"), cl("textarea"), className)} value={value} onChange={e => onChange(e.currentTarget.value)} />;
}

const MENU_ROW = 32;
const MENU_MAX = 280;

/**
 * Dropdown with an own menu (the native <select> popup can't be styled). The menu is portaled to <body> so groups and
 * windows don't clip it, opens upwards when there's no room below, and is driven from the focused trigger (arrows,
 * Enter, Esc, Home/End) – focus never leaves it, so Discord's modal focus lock doesn't interfere.
 */
export function Select<T extends string | number>({ value, options, onChange, width, className, disabled }: {
    value: T; options: { value: T; label: string; }[]; onChange(v: T): void; width?: number | string; className?: string; disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean; maxHeight: number; } | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const index = options.findIndex(o => o.value === value);

    const show = () => {
        if (disabled || !trigger.current) return;
        const r = trigger.current.getBoundingClientRect();
        const below = innerHeight - r.bottom - 12, above = r.top - 12;
        const up = below < Math.min(options.length * MENU_ROW + 10, MENU_MAX) && above > below;
        setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: r.width, up, maxHeight: Math.min(MENU_MAX, up ? above : below) });
        setActive(Math.max(0, index));
        setOpen(true);
    };

    const pick = (i: number) => {
        setOpen(false);
        const o = options[i];
        if (o && o.value !== value) onChange(o.value);
    };

    // Close on outside click, scroll / resize outside the menu, and Esc (captured, so the window around stays open)
    useEffect(() => {
        if (!open) return;
        const inside = (t: EventTarget | null) => !!t && (trigger.current?.contains(t as Node) || menu.current?.contains(t as Node));
        const down = (e: MouseEvent) => { if (!inside(e.target)) setOpen(false); };
        const scroll = (e: Event) => { if (!inside(e.target)) setOpen(false); };
        const resize = () => setOpen(false);
        const esc = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            e.preventDefault();
            setOpen(false);
        };
        addEventListener("mousedown", down, true);
        addEventListener("scroll", scroll, true);
        addEventListener("resize", resize);
        addEventListener("keydown", esc, true);
        return () => {
            removeEventListener("mousedown", down, true);
            removeEventListener("scroll", scroll, true);
            removeEventListener("resize", resize);
            removeEventListener("keydown", esc, true);
        };
    }, [open]);

    useEffect(() => {
        if (open) menu.current?.children[active]?.scrollIntoView({ block: "nearest" });
    }, [open, active]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        const last = options.length - 1;
        const step = (i: number) => { e.preventDefault(); open ? setActive(Math.max(0, Math.min(last, i))) : show(); };
        switch (e.key) {
            case "ArrowDown": return step(active + 1);
            case "ArrowUp": return step(active - 1);
            case "Home": return step(0);
            case "End": return step(last);
            case "Enter":
            case " ":
                e.preventDefault();
                return open ? pick(active) : show();
            case "Tab": return setOpen(false);
        }
    };

    return (
        <>
            <button
                ref={trigger}
                type="button"
                className={classes(cl("field"), cl("select"), open && cl("select-open"), className)}
                style={width != null ? { width } : undefined}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => open ? setOpen(false) : show()}
                onKeyDown={onKeyDown}
            >
                <span className={cl("select-value")}>{options[index]?.label ?? ""}</span>
                <Icon path={ICONS.chevronDown} size={14} className={cl("select-arrow")} />
            </button>
            {open && pos && ReactDOM.createPortal(
                <div
                    ref={menu}
                    role="listbox"
                    className={classes(cl("menu"), pos.up && cl("menu-up"))}
                    style={{ left: pos.left, top: pos.top, minWidth: pos.width, maxHeight: pos.maxHeight }}
                >
                    {options.map((o, i) => (
                        <div
                            key={String(o.value)}
                            role="option"
                            aria-selected={i === index}
                            className={classes(cl("menu-item"), i === active && cl("menu-item-active"), i === index && cl("menu-item-selected"))}
                            onMouseEnter={() => setActive(i)}
                            // keep focus on the trigger
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => pick(i)}
                        >
                            <span className={cl("menu-label")}>{o.label}</span>
                            {i === index && <Icon path={ICONS.check} size={14} className={cl("menu-check")} />}
                        </div>
                    ))}
                </div>,
                document.body
            )}
        </>
    );
}

/** Label + control, stacked (forms in dialogs) */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode; }) {
    return (
        <div className={cl("form-field")}>
            <span className={cl("form-label")}>{label}</span>
            {children}
            {hint && <span className={cl("form-hint")}>{hint}</span>}
        </div>
    );
}

// ---------------------------------------------------------------- Grouped lists (iOS Settings)

/** Titled group of rows with an optional explanation below */
export function Section({ title, footer, children, right, plain }: {
    title?: ReactNode; footer?: ReactNode; children: ReactNode; right?: ReactNode;
    /** No rounded group background, e.g. for a grid of cards */
    plain?: boolean;
}) {
    return (
        <section className={cl("section")}>
            {(title || right) && (
                <div className={cl("section-head")}>
                    {title && <h3 className={cl("section-title")}>{title}</h3>}
                    {right && <span className={cl("section-right")}>{right}</span>}
                </div>
            )}
            {plain ? children : <div className={cl("group")}>{children}</div>}
            {footer && <p className={cl("section-footer")}>{footer}</p>}
        </section>
    );
}

/** Rounded group of rows without a section around it (e.g. several cards in one section) */
export function Group({ children, className }: { children: ReactNode; className?: string; }) {
    return <div className={classes(cl("group"), className)}>{children}</div>;
}

/** One row of a group: leading picture, title + subtitle, trailing content */
export function Row({ leading, title, subtitle, note, trailing, onClick, chevron, className, dim, align, children }: {
    leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; note?: ReactNode; trailing?: ReactNode;
    onClick?(e: React.MouseEvent): void; chevron?: boolean; className?: string; dim?: boolean;
    /** "top" for rows with several lines (picture and trailing stay at the top) */
    align?: "center" | "top";
    children?: ReactNode;
}) {
    return (
        <div
            className={classes(cl("row"), onClick && cl("row-click"), dim && cl("row-dim"), !leading && cl("row-flat"), align === "top" && cl("row-top"), className)}
            onClick={onClick}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={onClick ? e => {
                if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                    e.preventDefault();
                    onClick(e as any);
                }
            } : undefined}
        >
            {leading && <span className={cl("row-leading")}>{leading}</span>}
            <div className={cl("row-main")}>
                <div className={cl("row-title")}>{title}</div>
                {subtitle && <div className={cl("row-sub")}>{subtitle}</div>}
                {note && <div className={cl("row-note")}>{note}</div>}
                {children}
            </div>
            {trailing != null && <div className={cl("row-trailing")}>{trailing}</div>}
            {chevron && <Icon path={ICONS.chevron} size={14} className={cl("row-chevron")} />}
        </div>
    );
}

/** Settings row with a switch; the whole row toggles */
export function ToggleRow({ icon, color, title, subtitle, checked, onChange, disabled, leading }: {
    icon?: string; color?: UiColor; title: ReactNode; subtitle?: ReactNode; checked: boolean; onChange(v: boolean): void; disabled?: boolean; leading?: ReactNode;
}) {
    return (
        <Row
            leading={leading ?? (icon && <Glyph path={icon} color={color} />)}
            title={title}
            subtitle={subtitle}
            dim={disabled}
            onClick={disabled ? undefined : () => onChange(!checked)}
            trailing={<Toggle checked={checked} onChange={onChange} disabled={disabled} label={typeof title === "string" ? title : undefined} />}
        />
    );
}

/** Blue text row, e.g. "Add rule…" at the end of a group */
export function LinkRow({ children, onClick, icon, destructive }: { children: ReactNode; onClick(): void; icon?: string; destructive?: boolean; }) {
    return (
        <button type="button" className={classes(cl("link-row"), destructive && cl("link-row-destructive"))} onClick={onClick}>
            {icon && <Icon path={icon} size={16} />}
            {children}
        </button>
    );
}

/** Row of big numbers (widgets) */
export function Stats({ items }: { items: { value: ReactNode; label: ReactNode; color?: UiColor; title?: string; }[]; }) {
    return (
        <div className={cl("stats")} style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
            {items.map((s, i) => (
                <div key={i} className={cl("stat")} title={s.title}>
                    <span className={cl("stat-value")} style={s.color ? { color: `var(--vc-ui-${s.color})` } : undefined}>{s.value}</span>
                    <span className={cl("stat-label")}>{s.label}</span>
                </div>
            ))}
        </div>
    );
}

export function Empty({ icon, title, hint, children }: { icon?: string; title: ReactNode; hint?: ReactNode; children?: ReactNode; }) {
    return (
        <div className={cl("empty")}>
            {icon && <span className={cl("empty-icon")}><Icon path={icon} size={28} /></span>}
            <b>{title}</b>
            {hint && <span>{hint}</span>}
            {children}
        </div>
    );
}

/** Gray explanation box */
export function Note({ children, tone }: { children: ReactNode; tone?: "warn" | "bad" | "ok"; }) {
    return <div className={classes(cl("note"), tone && cl(`note-${tone}`))}>{children}</div>;
}

export function Avatar({ src, size = 32, fallback = ICONS.user, square }: { src?: string; size?: number; fallback?: string; square?: boolean; }) {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [src]);
    return (
        <span className={classes(cl("avatar"), square && cl("avatar-square"))} style={{ width: size, height: size }}>
            {src && !failed
                ? <img src={src} width={size} height={size} alt="" onError={() => setFailed(true)} />
                : <Icon path={fallback} size={Math.round(size * 0.55)} />}
        </span>
    );
}

// ---------------------------------------------------------------- Windows

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const GLYPHS = new Map(Object.entries(APP_GLYPHS).map(([name, glyph]) => [normalize(name), glyph]));
const GLYPH_PREFIX = "vc-glyph:";

/**
 * App icon artwork of a plugin by name ("Friend Dock" finds FriendDock), or undefined.
 * Returns a token for AppArtwork (the artwork is a duotone line icon from appGlyphs.ts, not an image).
 */
export const appArtwork = (name: unknown) =>
    typeof name === "string" && GLYPHS.has(normalize(name)) ? GLYPH_PREFIX + normalize(name) : undefined;

/**
 * A plugin's app icon: its duotone line icon (white + the plugin's color) on a transparent ground; any other `src` is
 * shown as an image. `size` is the box (like AppIcon); `pulse` shows a pulsing dot while the plugin is busy.
 */
export function AppArtwork({ src, size = 42, pulse }: { src: string; size?: number; pulse?: boolean; }) {
    const glyph = src.startsWith(GLYPH_PREFIX) ? GLYPHS.get(src.slice(GLYPH_PREFIX.length)) : undefined;
    const art = glyph
        ? (
            <span className={cl("app-art")} style={{ width: size, height: size, "--vc-ui-art": `var(--vc-ui-${glyph.color})` } as CSSProperties}>
                <svg viewBox="0 0 24 24" width={Math.round(size * 0.74)} height={Math.round(size * 0.74)} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {glyph.base.map(d => <path key={d} d={d} />)}
                    <g className={cl("app-art-accent")}>{glyph.accent.map(d => <path key={d} d={d} />)}</g>
                </svg>
            </span>
        )
        : <img src={src} className={classes(cl("app-art"), cl("app-art-img"))} style={{ width: size, height: size }} alt="" draggable={false} />;
    return pulse ? <span className={cl("app-art-pulse")}>{art}</span> : art;
}

/** Header picture of a plugin: its artwork (with a busy ring if `pulse`), else the plugin's own fallback logo */
export function PluginArtwork({ app, pulse, size, fallback }: { app: string; pulse?: boolean; size?: number; fallback?: ReactNode; }) {
    const src = appArtwork(app);
    return src ? <AppArtwork src={src} size={size} pulse={pulse} /> : <>{fallback}</>;
}

export interface WindowHeader {
    /** Plugin whose app icon artwork to show; by default the title is tried as plugin name */
    app?: string;
    title: ReactNode;
    subtitle?: ReactNode;
    /** Green subtitle, e.g. while something runs */
    live?: boolean;
    icon?: string;
    iconColor?: UiColor;
    /** Own picture instead of icon + color */
    iconNode?: ReactNode;
    /** Buttons left of the close button */
    actions?: ReactNode;
}

export interface WindowAction {
    label: ReactNode;
    onClick(): void;
    variant?: ButtonVariant;
    color?: UiColor;
    disabled?: boolean;
}

/**
 * Content of a window: header with app icon, fixed area (segments, stats …), scrolling body, buttons at the bottom.
 * Use inside openWindow(); can also stand alone (e.g. in a settings panel) with `embedded`.
 */
export function Sheet({ header, onClose, top, children, footer, notice, actions, embedded, height, paused, className }: {
    header?: WindowHeader; onClose?(): void; top?: ReactNode; children?: ReactNode;
    /** Free content above the action buttons */
    footer?: ReactNode;
    /** Warning above the action buttons (e.g. why Save is disabled) */
    notice?: ReactNode;
    actions?: WindowAction[];
    /** Inside a page (settings panel) instead of a window: no fixed height, no own scroll */
    embedded?: boolean;
    /** Fixed window height; default fits the content up to 82% of the screen */
    height?: number | string;
    /** Grays out the app icon (plugin paused) */
    paused?: boolean;
    className?: string;
}) {
    return (
        <div
            className={classes(cl("sheet"), embedded && cl("sheet-embedded"), paused && cl("sheet-paused"), className)}
            style={height != null ? { height } : undefined}
        >
            {header && (
                <header className={cl("header")}>
                    {header.iconNode ?? (() => {
                        const art = appArtwork(header.app ?? header.title);
                        return art ? <AppArtwork src={art} size={36} /> : header.icon && <AppIcon path={header.icon} color={header.iconColor} size={36} />;
                    })()}
                    <div className={cl("header-text")}>
                        <h2 className={cl("title")}>{header.title}</h2>
                        {header.subtitle && <span className={classes(cl("subtitle"), header.live && cl("subtitle-live"))}>{header.subtitle}</span>}
                    </div>
                    {header.actions}
                    {onClose && !embedded && <RoundButton icon={ICONS.close} label="Close" onClick={onClose} className={cl("close")} />}
                </header>
            )}
            {top}
            <div className={cl("body")}>{children}</div>
            {(footer || notice || actions?.length) && (
                <footer className={cl("footer")}>
                    {notice && <Note tone="warn">{notice}</Note>}
                    {footer}
                    {!!actions?.length && (
                        <div className={cl("actions")}>
                            {actions.map((a, i) => (
                                <Button key={i} variant={a.variant ?? (i === actions.length - 1 ? "filled" : "gray")} color={a.color} disabled={a.disabled} onClick={a.onClick}>
                                    {a.label}
                                </Button>
                            ))}
                        </div>
                    )}
                </footer>
            )}
        </div>
    );
}

export type WindowSize = "small" | "medium" | "large" | "dynamic";

const SIZES: Record<WindowSize, ModalSize> = {
    small: ModalSize.SMALL,
    medium: ModalSize.MEDIUM,
    large: ModalSize.LARGE,
    dynamic: ModalSize.DYNAMIC
};

/** Vencord types it as never */
const Root = ModalRoot as any;

/** Opens a glass window (Discord modal). render gets close() and should return a <Sheet>. */
export function openWindow(render: (close: () => void) => ReactNode, { size = "medium", className }: { size?: WindowSize; className?: string; } = {}) {
    return openModal(props => (
        <Root {...props} size={SIZES[size]} className={classes(cl("window"), cl(`window-${size}`), className)}>
            <ErrorBoundary noop>
                {render(props.onClose)}
            </ErrorBoundary>
        </Root>
    ));
}

/** macOS alert: icon, title, text and up to three buttons. Resolves with the clicked index (-1 = closed). */
export function openAlert({ title, body, icon, iconColor = "blue", buttons }: {
    title: ReactNode; body?: ReactNode; icon?: string; iconColor?: UiColor;
    buttons: { label: ReactNode; variant?: ButtonVariant; color?: UiColor; icon?: string; }[];
}) {
    return new Promise<number>(resolve => {
        let done = false;
        const finish = (i: number) => { if (!done) { done = true; resolve(i); } };
        // An animated button (trash, leave) plays its click animation before the alert closes
        const click = (i: number, close: () => void) => {
            if (done) return;
            finish(i);
            const icon = buttons[i].icon;
            if (icon === ICONS.trash || icon === ICONS.leave) setTimeout(close, iconAnim(icon).ms + 20);
            else close();
        };
        openModal(props => (
            <Root {...props} size={ModalSize.SMALL} className={classes(cl("window"), cl("alert-window"))}>
                <div className={cl("alert")}>
                    {icon && <AppIcon path={icon} color={iconColor} size={56} />}
                    <h2 className={cl("alert-title")}>{title}</h2>
                    {body && <div className={cl("alert-body")}>{body}</div>}
                    <div className={classes(cl("alert-buttons"), buttons.length > 2 && cl("alert-buttons-stacked"))}>
                        {buttons.map((b, i) => (
                            <Button key={i} wide variant={b.variant ?? (i === buttons.length - 1 ? "filled" : "gray")} color={b.color} icon={b.icon} onClick={() => click(i, props.onClose)}>
                                {b.label}
                            </Button>
                        ))}
                    </div>
                </div>
            </Root>
        ), { onCloseCallback: () => finish(-1) });
    });
}

/** Yes/no question; true if confirmed */
export async function confirm({ title, body, confirmText = "OK", cancelText = "Cancel", destructive, icon, iconColor, confirmIcon }: {
    title: ReactNode; body?: ReactNode; confirmText?: string; cancelText?: string; destructive?: boolean; icon?: string; iconColor?: UiColor;
    /** Icon in the confirm button; a deleting / leaving dialog (trash / leave icon) gets the animated one by default */
    confirmIcon?: string;
}) {
    const i = await openAlert({
        title, body, icon, iconColor: iconColor ?? (destructive ? "red" : "blue"),
        buttons: [
            { label: cancelText },
            { label: confirmText, variant: destructive ? "destructive" : "filled", icon: confirmIcon ?? (destructive && (icon === ICONS.trash || icon === ICONS.leave) ? icon : undefined) }
        ]
    });
    return i === 1;
}

// ---------------------------------------------------------------- Popover (glass card for popouts)

/** Glass card for Discord Popouts and own floating panels */
export function Popover({ children, className, width, style }: { children: ReactNode; className?: string; width?: number; style?: CSSProperties; }) {
    return <div className={classes(cl("popover"), className)} style={{ width, ...style }}>{children}</div>;
}

// ---------------------------------------------------------------- Notifications (top right, macOS style)

export type NotifyKind = "success" | "attention" | "info" | "error";

export interface NotifyOptions {
    title: ReactNode;
    body?: ReactNode;
    kind?: NotifyKind;
    /** Picture at the left instead of the kind icon */
    image?: string;
    /** Own icon path (with the kind's color) */
    icon?: string;
    /** Name of the plugin, shown small like the app name in macOS */
    app?: string;
    /** Shown below the text, e.g. a reward */
    side?: ReactNode;
    onClick?(): void;
    /** ms, default 6000 */
    duration?: number;
}

interface NotifyItem extends NotifyOptions { id: number; }

const MAX_NOTIFICATIONS = 4;
let notifications: NotifyItem[] = [];
let nextNotifyId = 1;
const notifyListeners = new Set<() => void>();
const emitNotify = () => notifyListeners.forEach(l => l());
let notifyRoot: ReturnType<typeof createRoot> | null = null;

function mountNotifications() {
    if (notifyRoot) return;
    const host = document.createElement("div");
    host.className = cl("notify-host");
    document.body.appendChild(host);
    notifyRoot = createRoot(host);
    notifyRoot.render(<ErrorBoundary noop><Notifications /></ErrorBoundary>);
}

/** Shows a macOS style notification at the top right inside Discord */
export function notify(options: NotifyOptions) {
    mountNotifications();
    notifications = [...notifications, { ...options, id: nextNotifyId++ }].slice(-MAX_NOTIFICATIONS);
    emitNotify();
}

function dismissNotification(id: number) {
    notifications = notifications.filter(t => t.id !== id);
    emitNotify();
}

const KIND_ICON: Record<NotifyKind, string> = {
    success: ICONS.check,
    attention: ICONS.warning,
    info: ICONS.info,
    error: ICONS.warning
};

function Notification({ item }: { item: NotifyItem; }) {
    const kind = item.kind ?? "info";
    const [leaving, setLeaving] = useState(false);
    const [broken, setBroken] = useState(false);
    const hovered = useRef(false);
    const left = useRef(item.duration ?? 6000);

    const close = () => {
        setLeaving(true);
        setTimeout(() => dismissNotification(item.id), 180);
    };

    // Counts down only while not hovered
    useEffect(() => {
        let last = Date.now();
        const t = setInterval(() => {
            const now = Date.now();
            if (!hovered.current) left.current -= now - last;
            last = now;
            if (left.current <= 0) {
                clearInterval(t);
                close();
            }
        }, 50);
        return () => clearInterval(t);
    }, []);

    return (
        <div
            className={classes(cl("notify"), cl(`notify-${kind}`), leaving && cl("notify-leave"), item.onClick && cl("notify-click"))}
            onMouseEnter={() => hovered.current = true}
            onMouseLeave={() => hovered.current = false}
            onClick={() => {
                if (!item.onClick) return;
                item.onClick();
                close();
            }}
        >
            <button type="button" className={cl("notify-close")} aria-label="Close" onClick={e => { e.stopPropagation(); close(); }}>
                <Icon path={ICONS.close} size={10} />
            </button>
            {item.image && !broken
                ? <img className={cl("notify-img")} src={item.image} alt="" onError={() => setBroken(true)} />
                : <div className={cl("notify-icon")}><Icon path={item.icon ?? KIND_ICON[kind]} size={20} /></div>}
            <div className={cl("notify-main")}>
                <div className={cl("notify-head")}>
                    <span className={cl("notify-title")}>{item.title}</span>
                    <span className={cl("notify-when")}>{item.app ?? "now"}</span>
                </div>
                {item.body && <div className={cl("notify-body")}>{item.body}</div>}
                {item.side && <div className={cl("notify-side")}>{item.side}</div>}
            </div>
        </div>
    );
}

function Notifications() {
    const [, setTick] = useState(0);
    useEffect(() => {
        const l = () => setTick(t => t + 1);
        notifyListeners.add(l);
        return () => void notifyListeners.delete(l);
    }, []);
    return <div className={cl("notify-stack")}>{notifications.map(t => <Notification key={t.id} item={t} />)}</div>;
}

// ---------------------------------------------------------------- Hooks

/** Re-renders when a plain listener set fires (simple stores) */
export function useListener(listeners: Set<() => void>) {
    const [, setTick] = useState(0);
    useEffect(() => {
        const l = () => setTick(t => t + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, [listeners]);
}

// ---------------------------------------------------------------- Title bar (arrangeable icons)

export { startArranging, titleBarSlot } from "./titlebar";
