/*
 * Radar – own building blocks. Standard parts (switches, buttons, segments, fields, rows …) come from the shared
 * _ui kit; here only what's special to Radar: its icons, the logo and the pickers of the rule editor.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@api/Styles";
import { useMemo, useState } from "@webpack/common";

import { Avatar, ICONS, Pill, Pills, SearchField, strokeIcon, UiColor } from "../_ui";
import type { IconName as EngineIcon } from "./engine";
import type { ActionType, TriggerType } from "./store";

export const cl = classNameFactory("vc-radar-");

// ---------------------------------------------------------------- Icons

/** Radar's own 24×24 icon paths; everything common comes from the kit's ICONS */
/** Circle as path data (for Lucide icons drawn with strokeIcon) */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
const SPEAKER = "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z";

/** Radar's icons – thin Lucide strokes like the kit; shared ones come from the kit (they have their own button animations) */
export const RI = {
    search: ICONS.search,
    bell: ICONS.bell,
    at: strokeIcon(circle(12, 12, 4), "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"),
    voiceIn: strokeIcon(SPEAKER, "M16 9a5 5 0 0 1 0 6", "M19.364 18.364a9 9 0 0 0 0-12.728"),
    voiceOut: strokeIcon(SPEAKER, "m22 9-6 6", "m16 9 6 6"),
    gamepad: strokeIcon("M6 11h4", "M8 9v4", "M15 12h.01", "M18 10h.01", "M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"),
    gamepadOff: strokeIcon(circle(12, 12, 10), "M10 9h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z"),
    clock: ICONS.clock,
    sound: ICONS.music,
    // Do Not Disturb
    moon: strokeIcon(circle(12, 12, 10), "M8 12h8"),
    flash: ICONS.zap,
    highlight: strokeIcon("M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5", "M9 18h6", "M10 22h4"),
    inbox: ICONS.inbox,
    bookmark: ICONS.bookmark,
    rules: ICONS.sliders,
    jump: ICONS.arrowRight,
    doneAll: ICONS.checkAll,
    server: ICONS.server,
    image: ICONS.image,
    file: ICONS.file,
    hash: ICONS.hash
} satisfies Record<EngineIcon, string> & Record<string, string>;

export type RadarIcon = keyof typeof RI;

/** Glyph colors per trigger and action, so rules read at a glance */
export const TRIGGER_COLOR: Record<TriggerType, UiColor> = {
    keyword: "blue",
    mention: "purple",
    voiceJoin: "green",
    voiceLeave: "orange",
    gameStart: "indigo",
    gameStop: "gray",
    time: "teal"
};

export const ACTION_COLOR: Record<ActionType, UiColor> = {
    notify: "red",
    sound: "pink",
    status: "indigo",
    flash: "yellow",
    highlight: "orange",
    inbox: "blue"
};

/** Logo: radar screen with a rotating sweep */
export function RadarLogo({ size = 20, className, spin }: { size?: number; className?: string; spin?: boolean; }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden>
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
            <circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
            <g className={spin ? cl("sweep") : undefined}>
                <path d="M12 12 L12 3 A9 9 0 0 1 19.8 7.5 Z" fill="currentColor" opacity="0.35" />
                <line x1="12" y1="12" x2="12" y2="3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </g>
            <circle cx="12" cy="12" r="1.6" fill="currentColor" />
            <circle cx="16.2" cy="8.4" r="1.3" fill="currentColor" />
        </svg>
    );
}

// ---------------------------------------------------------------- Multi-select (servers, channels, people)

export interface PickerOption {
    id: string;
    label: string;
    sub?: string;
    icon?: string;
}

export function MultiPicker({ value, onChange, options, resolve, placeholder, fallbackIcon, allowIds, emptyText }: {
    value: string[];
    onChange(v: string[]): void;
    /** Only computed when opened */
    options(): PickerOption[];
    resolve(id: string): PickerOption;
    placeholder: string;
    /** Icon path when there is no picture */
    fallbackIcon: string;
    /** Accept arbitrary IDs (numbers), e.g. for people who aren't friends */
    allowIds?: boolean;
    emptyText?: string;
}) {
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const all = useMemo(() => open ? options() : [], [open]);

    const q = query.trim().toLowerCase();
    const results = all
        .filter(o => !value.includes(o.id) && (!q || o.label.toLowerCase().includes(q) || o.sub?.toLowerCase().includes(q) || o.id === q))
        .slice(0, 60);
    const rawId = allowIds && /^\d{15,21}$/.test(q) && !value.includes(q) && !results.some(r => r.id === q) ? q : null;

    const add = (id: string) => {
        onChange([...value, id]);
        setQuery("");
    };

    return (
        <div className={cl("picker")}>
            {value.length > 0 && (
                <Pills>
                    {value.map(id => {
                        const o = resolve(id);
                        return <Pill key={id} leading={<Avatar src={o.icon} fallback={fallbackIcon} size={18} />} onRemove={() => onChange(value.filter(v => v !== id))}>{o.label}</Pill>;
                    })}
                </Pills>
            )}
            <SearchField
                value={query}
                placeholder={placeholder}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                onChange={setQuery}
                onKeyDown={e => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        if (results[0]) add(results[0].id);
                        else if (rawId) add(rawId);
                    } else if (e.key === "Escape") {
                        e.currentTarget.blur();
                    }
                }}
            />
            {open && (
                <div className={cl("picker-list")} onMouseDown={e => e.preventDefault()}>
                    {rawId && (
                        <button type="button" className={cl("picker-item")} onClick={() => add(rawId)}>
                            <Avatar fallback={fallbackIcon} size={24} />
                            <span className={cl("picker-text")}>
                                <span>Use ID {rawId}</span>
                            </span>
                        </button>
                    )}
                    {results.map(o => (
                        <button type="button" key={o.id} className={cl("picker-item")} onClick={() => add(o.id)}>
                            <Avatar src={o.icon} fallback={fallbackIcon} size={24} />
                            <span className={cl("picker-text")}>
                                <span>{o.label}</span>
                                {o.sub && <small>{o.sub}</small>}
                            </span>
                        </button>
                    ))}
                    {!results.length && !rawId && <div className={cl("picker-empty")}>{emptyText ?? "Nothing found"}</div>}
                </div>
            )}
        </div>
    );
}

/** Free-text list (words, game names): Enter or comma adds an entry */
export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange(v: string[]): void; placeholder: string; }) {
    const [text, setText] = useState("");
    const commit = () => {
        const parts = text.split(",").map(t => t.trim()).filter(Boolean).filter(t => !value.includes(t));
        if (parts.length) onChange([...value, ...parts]);
        setText("");
    };
    return (
        <div className={cl("taginput")}>
            {value.map(v => <Pill key={v} onRemove={() => onChange(value.filter(x => x !== v))}>{v}</Pill>)}
            <input
                className={cl("taginput-input")}
                value={text}
                placeholder={value.length ? "" : placeholder}
                onChange={e => setText(e.currentTarget.value)}
                onBlur={commit}
                onKeyDown={e => {
                    if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        commit();
                    } else if (e.key === "Backspace" && !text && value.length) {
                        onChange(value.slice(0, -1));
                    }
                }}
            />
        </div>
    );
}
