/*
 * PrivacyScreen – UI: settings panel (Curtain / Streaming & capture) with the curtain look editor and live
 * preview, panic key recorder and the streaming protection picker (servers/channels). Built with the shared _ui kit.
 * Moved out of OpSec.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { useForceUpdater } from "@utils/react";
import { GuildChannelStore, GuildStore, IconUtils, React, Tooltip, useEffect, useMemo, useRef, useState, useStateFromStores } from "@webpack/common";
import type { ReactNode } from "react";

import { Badge, Button, Glyph, Group, Icon, IconButton, ICONS as UI_ICONS, notify, NotifyKind, Pill, Pills, Row, SearchField, Section, Segmented, Sheet, Slider, State, strokeIcon, TextField, Toggle, ToggleRow, UiColor } from "../_ui";
import { buildCurtain, CURTAIN_ICONS, CurtainAnimation, CurtainIconName, CurtainOptions, CurtainStyle, DEFAULT_CURTAIN_TEXT, isCurtainShown, MASK_PATH, onCurtainChange, showCurtain, toggleCurtain } from "./curtain";
import { getCurtainOptions, getIdList, getPanicKey, setIds, settings, toggleId } from "./index";
import { DEFAULT_KEYBIND, isModifierCode, isValidKeybind, Keybind, keybindConflict, keybindFromEvent, keybindParts, recording, serializeKeybind } from "./keybind";
import { isGuardActive, isGuardPreview, onGuardChange, previewGuard, stopPreview } from "./stream";

const cl = classNameFactory("vc-privacyscreen-");

const PLATFORM = navigator.platform.toLowerCase();
const HAS_CONTENT_PROTECTION = PLATFORM.startsWith("win") || PLATFORM.startsWith("mac");

/** App icon color of PrivacyScreen (window header, settings) */
export const PRIVACY_COLOR: UiColor = "indigo";

/** Plugin event notification (replaces Discord toasts) */
export function privacyNotify(text: string, kind: NotifyKind = "success") {
    notify({ title: text, kind, app: "PrivacyScreen" });
}

// ---------------------------------------------------------------- Icons

/** Circle as path data (for Lucide icons drawn with strokeIcon) */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

/** Lucide stroke icons */
const ICONS = {
    eyeOff: MASK_PATH,
    eye: strokeIcon("M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0", circle(12, 12, 3)),
    file: UI_ICONS.file,
    camOff: strokeIcon("M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196", "M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2", "m2 2 20 20"),
    bolt: UI_ICONS.zap,
    play: UI_ICONS.play,
    cast: strokeIcon("M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6", "M2 12a9 9 0 0 1 8 8", "M2 16a5 5 0 0 1 4 4", "M2 20h.01"),
    restore: strokeIcon("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5")
};

export function MaskIcon({ size = 20, className }: { size?: number; className?: string; }) {
    return (
        <Icon path={MASK_PATH} size={size} className={classes(cl("icon"), className)} />
    );
}

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

function Kbd({ keys, live }: { keys: string[]; live?: boolean; }) {
    return (
        <span className={cl("kbd-group")}>
            {keys.map((k, i) => (
                <span key={k + i} className={classes(cl("kbd"), live && cl("kbd-live"))} style={{ animationDelay: `${i * 40}ms` }}>{k}</span>
            ))}
        </span>
    );
}

function useCurtainShown() {
    const forceUpdate = useForceUpdater();
    useEffect(() => onCurtainChange(forceUpdate), []);
    return isCurtainShown();
}

/** Indented option below a module (no glyph) */
function SubToggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange(v: boolean): void; label: ReactNode; hint?: ReactNode; disabled?: boolean; }) {
    return (
        <div className={cl("sub")}>
            <ToggleRow checked={checked} onChange={onChange} title={label} subtitle={hint} disabled={disabled} />
        </div>
    );
}

// ---------------------------------------------------------------- Streaming protection

function useGuard() {
    const forceUpdate = useForceUpdater();
    useEffect(() => onGuardChange(forceUpdate), []);
    return { active: isGuardActive(), preview: isGuardPreview() };
}

function GuildIcon({ id, icon, name }: { id: string; icon?: string | null; name: string; }) {
    const url = icon ? IconUtils.getGuildIconURL({ id, icon, size: 64, canAnimate: false }) : undefined;
    return url
        ? <img className={cl("guild-icon")} src={url} alt="" />
        : <span className={cl("guild-icon")}>{name.split(/\s+/).map(w => w[0]).join("").slice(0, 3)}</span>;
}

function GuildChannels({ guildId, hidden }: { guildId: string; hidden: Set<string>; }) {
    const channels = useMemo(() => {
        try {
            const list = (GuildChannelStore.getChannels(guildId)?.SELECTABLE ?? []) as any[];
            return list.map(c => c.channel).filter(Boolean) as { id: string; name: string; }[];
        } catch {
            return [];
        }
    }, [guildId]);

    if (!channels.length) return <div className={classes(cl("hint"), cl("guild-channels"))}>No channels found.</div>;

    return (
        <div className={cl("guild-channels")}>
            <Pills>
                {channels.map(c => (
                    <Pill
                        key={c.id}
                        selected={hidden.has(c.id)}
                        icon={hidden.has(c.id) ? ICONS.eyeOff : undefined}
                        title={hidden.has(c.id) ? "Hidden on stream" : "Hide on stream"}
                        onClick={() => toggleId("guardHiddenChannels", c.id, !hidden.has(c.id))}
                    >
                        # {c.name}
                    </Pill>
                ))}
            </Pills>
        </div>
    );
}

function GuardPicker({ disabled }: { disabled: boolean; }) {
    settings.use(["guardHiddenGuilds", "guardHiddenChannels"]);
    // Only compare a string – a new array per query would re-render endlessly
    const guildKey = useStateFromStores([GuildStore], () => (GuildStore.getGuildIds?.() ?? []).join(","));
    const guilds = useMemo(() => GuildStore.getGuildsArray?.() ?? [], [guildKey]);
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState<string | null>(null);

    const hiddenGuilds = new Set(getIdList("guardHiddenGuilds"));
    const hiddenChannels = new Set(getIdList("guardHiddenChannels"));
    const q = query.trim().toLowerCase();
    const list = [...guilds]
        .filter(g => !q || g.name.toLowerCase().includes(q))
        .sort((a, b) => Number(hiddenGuilds.has(b.id)) - Number(hiddenGuilds.has(a.id)) || a.name.localeCompare(b.name));
    const ids = list.map(g => g.id);
    const allHidden = ids.every(id => hiddenGuilds.has(id));
    const noneHidden = !ids.some(id => hiddenGuilds.has(id));

    return (
        <div className={classes(cl("sub"), cl("picker"), disabled && cl("off"))}>
            <div className={cl("picker-head")}>
                <span className={cl("label")}>Hide on stream</span>
                <span className={cl("value")}>{hiddenGuilds.size} {hiddenGuilds.size === 1 ? "server" : "servers"} · {hiddenChannels.size} {hiddenChannels.size === 1 ? "channel" : "channels"}</span>
            </div>
            <SearchField value={query} placeholder="Search servers …" onChange={setQuery} disabled={disabled} />
            <div className={cl("picker-bulk")}>
                <Button small variant="gray" icon={ICONS.eyeOff} disabled={disabled || allHidden} onClick={() => setIds("guardHiddenGuilds", ids, true)}>
                    {q ? `Hide ${list.length} found` : "Hide all"}
                </Button>
                <Button small variant="gray" icon={ICONS.eye} disabled={disabled || noneHidden} onClick={() => setIds("guardHiddenGuilds", ids, false)}>
                    {q ? `Unhide ${list.length} found` : "Unhide all"}
                </Button>
            </div>
            <Group className={cl("guild-list")}>
                {list.map(g => {
                    const on = hiddenGuilds.has(g.id);
                    const expanded = open === g.id;
                    const toggle = () => !disabled && toggleId("guardHiddenGuilds", g.id, !on);
                    return (
                        <div key={g.id}>
                            <Row
                                leading={<GuildIcon id={g.id} icon={g.icon} name={g.name} />}
                                title={g.name}
                                dim={disabled}
                                onClick={disabled ? undefined : toggle}
                                trailing={
                                    <span className={cl("guild-trail")}>
                                        {on && <Badge color="orange" icon={ICONS.eyeOff}>Hidden</Badge>}
                                        <span className={classes(cl("guild-expand"), expanded && cl("guild-expand-open"))}>
                                            <IconButton icon={UI_ICONS.chevron} label="Hide individual channels" disabled={disabled} onClick={e => { e.stopPropagation(); setOpen(expanded ? null : g.id); }} />
                                        </span>
                                        <Toggle checked={on} disabled={disabled} onChange={toggle} label={g.name} />
                                    </span>
                                }
                            />
                            {expanded && <GuildChannels guildId={g.id} hidden={hiddenChannels} />}
                        </div>
                    );
                })}
                {!list.length && <Row title="No servers found." dim />}
            </Group>
        </div>
    );
}

function GuardSettings({ enabled }: { enabled: boolean; }) {
    const s = settings.use(["guardNotifications", "guardBlurDms", "guardRevealOnHover", "guardStreamerMode"]);
    const { active, preview } = useGuard();
    const off = !enabled;

    return <>
        <div className={cl("sub")}>
            <Row
                dim={off}
                title={<State tone={active ? "ok" : preview ? "warn" : undefined}>{active ? "Active – you are streaming" : preview ? "Preview running" : "Waiting for your next stream"}</State>}
                subtitle="Test shows blurring & hiding for 12 seconds without streaming."
                trailing={
                    <Button small variant={preview ? "gray" : "tinted"} icon={preview ? ICONS.eyeOff : ICONS.play} disabled={off || active} onClick={() => preview ? stopPreview() : previewGuard(12)}>
                        {preview ? "Stop" : "Test"}
                    </Button>
                }
            />
        </div>
        <SubToggle disabled={off} checked={s.guardBlurDms} onChange={v => settings.store.guardBlurDms = v}
            label="Blur DMs" hint="Direct message list and DM avatars in the server bar." />
        <SubToggle disabled={off || !s.guardBlurDms} checked={s.guardRevealOnHover} onChange={v => settings.store.guardRevealOnHover = v}
            label="Reveal on hover" hint="Briefly uncover with the mouse – viewers will see it too." />
        <SubToggle disabled={off} checked={s.guardNotifications} onChange={v => settings.store.guardNotifications = v}
            label="Mute notifications" hint="No desktop popups & sounds from Discord, no Vencord popups. Uses Discord's Streamer Mode (turned on along with it)." />
        <SubToggle disabled={off} checked={s.guardStreamerMode} onChange={v => settings.store.guardStreamerMode = v}
            label="Turn on Discord's Streamer Mode" hint="Hides email, connections and invite links, among other things. Your previous state is restored afterwards." />
        <GuardPicker disabled={off} />
    </>;
}

// ---------------------------------------------------------------- Curtain

const STYLES: { value: CurtainStyle; label: string; }[] = [
    { value: "mask", label: "Eye" },
    { value: "glass", label: "Frosted glass" },
    { value: "black", label: "Black" },
    { value: "update", label: "Update" },
    { value: "matrix", label: "Matrix" },
    { value: "radar", label: "Radar" },
    { value: "aurora", label: "Aurora" },
    { value: "lock", label: "Lock screen" },
    { value: "terminal", label: "Terminal" },
    { value: "bsod", label: "Blue screen" }
];

/** Disguise styles show something entirely different – there is no icon and no custom look */
const DISGUISES: CurtainStyle[] = ["update", "bsod"];

const ICON_CHOICES: { value: CurtainIconName; label: string; }[] = [
    { value: "eyeOff", label: "Eye" },
    { value: "lock", label: "Lock" },
    { value: "shield", label: "Shield" },
    { value: "ghost", label: "Ghost" },
    { value: "skull", label: "Skull" },
    { value: "moon", label: "Moon" },
    { value: "coffee", label: "Coffee" },
    { value: "custom", label: "Custom" }
];

function CurtainGlyph({ name, size = 18 }: { name: CurtainIconName; size?: number; }) {
    if (name === "custom") return <span className={cl("icon-pick-custom")}>Aa</span>;
    return <Icon path={CURTAIN_ICONS[name]} size={size} />;
}

const ANIMATIONS: { value: CurtainAnimation; label: string; }[] = [
    { value: "fade", label: "Fade in" },
    { value: "zoom", label: "Zoom" },
    { value: "shutter", label: "Shutter" },
    { value: "glitch", label: "Glitch" }
];

/** Curtain accent choices (stored as hex in the settings, the curtain itself draws with them) */
const ACCENTS = ["#3ddc97", "#4c9bff", "#8b7bff", "#ff5c5c", "#ffb020", "#f4f4f5"];

const MOCK_AVATARS: UiColor[] = ["orange", "indigo", "green", "yellow"];

function MockDiscord() {
    return (
        <div className={cl("mock")} aria-hidden>
            <div className={cl("mock-servers")}>{[0, 1, 2, 3].map(i => <i key={i} />)}</div>
            <div className={cl("mock-channels")}>{[70, 55, 80, 60, 45].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>
            <div className={cl("mock-chat")}>
                {[[60, 85], [40, 70], [75, 50], [55, 90]].map(([a, b], i) => (
                    <div key={i} className={cl("mock-msg")}>
                        <span className={cl("mock-avatar")} style={{ background: `var(--vc-ui-${MOCK_AVATARS[i]})` }} />
                        <span className={cl("mock-lines")}><i style={{ width: `${a}%` }} /><i style={{ width: `${b}%` }} /></span>
                    </div>
                ))}
                <div className={cl("mock-input")} />
            </div>
        </div>
    );
}

function CurtainPreview({ options, replay }: { options: CurtainOptions; replay: number; }) {
    const host = useRef<HTMLDivElement>(null);
    const node = useRef<HTMLDivElement | null>(null);
    const structural = [options.style, options.animation, options.showIcon, options.icon, options.iconCustom, options.showText, options.text, options.clickToUnlock, options.hotkeyLabel, options.style === "matrix" || options.style === "terminal" ? options.accent : "", replay];

    useEffect(() => {
        const inst = buildCurtain(options, true);
        node.current = inst.el;
        host.current?.appendChild(inst.el);
        return () => {
            inst.destroy();
            inst.el.remove();
            node.current = null;
        };
    }, structural);

    // Sliders only change CSS variables – no rebuild, no animation restart
    useEffect(() => {
        const n = node.current;
        if (!n) return;
        n.style.setProperty("--privacyscreen-c-accent", options.accent);
        n.style.setProperty("--privacyscreen-c-opacity", String(options.opacity / 100));
        n.style.setProperty("--privacyscreen-c-blur", `${options.blur}px`);
    }, [options.accent, options.opacity, options.blur, ...structural]);

    return (
        <div className={cl("preview")} ref={host}>
            <MockDiscord />
        </div>
    );
}

function SliderRow({ label, value, min, max, unit, onChange, disabled }: {
    label: string; value: number; min: number; max: number; unit: string; onChange(v: number): void; disabled?: boolean;
}) {
    return (
        <Row title={label} dim={disabled}>
            <div className={classes(cl("slider"), disabled && cl("off"))}>
                <Slider value={value} min={min} max={max} format={v => `${v}${unit}`} onChange={onChange} />
            </div>
        </Row>
    );
}

function KeybindRecorder() {
    const { panicKey } = settings.use(["panicKey"]);
    const current = getPanicKey();
    const [rec, setRec] = useState(false);
    const [live, setLive] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(0);

    useEffect(() => {
        if (!rec) return;
        recording.active = true;
        setLive([]);
        setError(null);

        const partsOf = (e: KeyboardEvent) => [e.ctrlKey && "Ctrl", e.shiftKey && "Shift", e.altKey && "Alt", e.metaKey && "Win"].filter(Boolean) as string[];

        const onDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) return setRec(false);
            if (isModifierCode(e.code)) return setLive(partsOf(e));

            const k: Keybind = keybindFromEvent(e);
            if (!isValidKeybind(k)) {
                setLive(keybindParts(k));
                setError("Combine with Ctrl, Alt or Win – or use an F key.");
                return;
            }
            settings.store.panicKey = serializeKeybind(k);
            setSaved(s => s + 1);
            setRec(false);
        };
        const onUp = (e: KeyboardEvent) => setLive(partsOf(e));

        window.addEventListener("keydown", onDown, true);
        window.addEventListener("keyup", onUp, true);
        return () => {
            recording.active = false;
            window.removeEventListener("keydown", onDown, true);
            window.removeEventListener("keyup", onUp, true);
        };
    }, [rec]);

    const conflict = keybindConflict(current);

    return (
        <div className={classes(cl("sub"), cl("pad"))}>
            <div className={cl("keybind")}>
                <button
                    type="button"
                    className={classes(cl("keybind-box"), rec && cl("keybind-rec"))}
                    onClick={() => setRec(r => !r)}
                >
                    {rec
                        ? live.length
                            ? <Kbd keys={[...live, "…"]} live />
                            : <span className={cl("keybind-prompt")}>Press your key combination …</span>
                        : <span key={saved} className={saved ? cl("flash") : undefined}><Kbd keys={keybindParts(current)} /></span>}
                    <span className={cl("keybind-action")}>{rec ? "Esc = Cancel" : "Change"}</span>
                </button>
                {panicKey !== DEFAULT_KEYBIND && !rec && (
                    <IconButton icon={ICONS.restore} label="Reset to Ctrl + Shift + L" onClick={() => settings.store.panicKey = DEFAULT_KEYBIND} />
                )}
            </div>
            {error && rec && <span className={classes(cl("hint"), cl("text-warn"))}>{error}</span>}
            {!rec && conflict && <span className={classes(cl("hint"), cl("text-warn"))}>Overrides "{conflict}".</span>}
        </div>
    );
}

function CurtainTab() {
    const s = settings.use();
    const options = getCurtainOptions();
    const [replay, setReplay] = useState(0);
    const usesLook = !DISGUISES.includes(s.curtainStyle as CurtainStyle);
    const usesIcon = usesLook && s.curtainStyle !== "terminal";
    const styleHint = s.curtainStyle === "update"
        ? "Disguises Discord as a running Windows update – nobody suspects a chat behind it."
        : s.curtainStyle === "bsod"
            ? "Disguises Discord as a Windows blue screen with counting-up progress."
            : s.curtainStyle === "terminal"
                ? "A terminal like in a hacker movie: types commands, runs progress bars and hex lines – endlessly. Your text appears as the window title."
                : undefined;

    return (
        <>
            <div className={cl("preview-wrap")}>
                <CurtainPreview options={options} replay={replay} />
                <div className={cl("preview-actions")}>
                    <Button small variant="gray" icon={ICONS.play} onClick={() => setReplay(r => r + 1)}>Replay</Button>
                    <Button small icon={MASK_PATH} onClick={() => showCurtain("manual")}>Test for real</Button>
                </div>
            </div>

            <Section title="Style" footer={styleHint} plain>
                <div className={cl("styles")}>
                    {STYLES.map(st => (
                        <button
                            type="button"
                            key={st.value}
                            className={classes(cl("style"), s.curtainStyle === st.value && cl("style-active"))}
                            onClick={() => settings.store.curtainStyle = st.value}
                        >
                            <span className={classes(cl("style-thumb"), cl(`thumb-${st.value}`))} style={{ "--privacyscreen-c-accent": s.curtainAccent } as any}>
                                {st.value === "update"
                                    ? <span className={cl("thumb-dots")} />
                                    : st.value === "bsod"
                                        ? <span className={cl("thumb-sad")}>:(</span>
                                        : st.value === "terminal"
                                            ? <span className={cl("thumb-term")}>&gt;_</span>
                                            : st.value === "lock"
                                                ? <span className={cl("thumb-clock")}>12:30</span>
                                                : st.value !== "matrix" && <MaskIcon size={16} />}
                            </span>
                            <span>{st.label}</span>
                        </button>
                    ))}
                </div>
            </Section>

            <Section title="Animation" plain>
                <Segmented small value={s.curtainAnimation as CurtainAnimation} options={ANIMATIONS} onChange={v => { settings.store.curtainAnimation = v; setReplay(r => r + 1); }} />
            </Section>

            {usesLook && (
                <Section title="Appearance">
                    <SliderRow label="Opacity" value={s.curtainOpacity} min={40} max={100} unit="%" onChange={v => settings.store.curtainOpacity = v} disabled={s.curtainStyle === "black"} />
                    <SliderRow label="Blur" value={s.curtainBlur} min={0} max={40} unit=" px" onChange={v => settings.store.curtainBlur = v} disabled={s.curtainStyle === "black"} />
                    <Row title="Accent color">
                        <div className={cl("swatches")}>
                            {ACCENTS.map(a => (
                                <Tip key={a} text={a.toUpperCase()}>
                                    <button type="button" className={classes(cl("swatch"), s.curtainAccent.toLowerCase() === a && cl("swatch-active"))} style={{ background: a }} onClick={() => settings.store.curtainAccent = a} aria-label={a} />
                                </Tip>
                            ))}
                            <Tip text="Custom color">
                                <label className={classes(cl("swatch"), cl("swatch-custom"), !ACCENTS.includes(s.curtainAccent.toLowerCase()) && cl("swatch-active"))}>
                                    <input type="color" value={s.curtainAccent} onChange={e => settings.store.curtainAccent = e.currentTarget.value} />
                                </label>
                            </Tip>
                        </div>
                    </Row>
                    {usesIcon && <ToggleRow icon={MASK_PATH} color={PRIVACY_COLOR} checked={s.curtainShowIcon} onChange={v => settings.store.curtainShowIcon = v} title="Show icon" />}
                    {usesIcon && s.curtainShowIcon && (
                        <div className={classes(cl("sub"), cl("pad"))}>
                            <div className={cl("icon-picks")}>
                                {ICON_CHOICES.map(i => (
                                    <Tip key={i.value} text={i.label}>
                                        <button
                                            type="button"
                                            aria-label={i.label}
                                            className={classes(cl("icon-pick"), s.curtainIcon === i.value && cl("icon-pick-active"))}
                                            onClick={() => settings.store.curtainIcon = i.value}
                                        >
                                            <CurtainGlyph name={i.value} />
                                        </button>
                                    </Tip>
                                ))}
                            </div>
                            {s.curtainIcon === "custom" && (
                                <TextField
                                    value={s.curtainIconCustom}
                                    maxLength={300}
                                    placeholder="Emoji (e.g. 🍕) or image link (https://…)"
                                    onChange={v => settings.store.curtainIconCustom = v}
                                />
                            )}
                        </div>
                    )}
                    <ToggleRow icon={ICONS.file} color="blue" checked={s.curtainShowText} onChange={v => settings.store.curtainShowText = v} title="Show text" subtitle="Enter your own text below – leave empty for the default text." />
                    {s.curtainShowText && (
                        <div className={classes(cl("sub"), cl("pad"))}>
                            <TextField
                                value={s.curtainText}
                                maxLength={60}
                                placeholder={DEFAULT_CURTAIN_TEXT}
                                onChange={v => settings.store.curtainText = v}
                            />
                        </div>
                    )}
                </Section>
            )}

            <Section title="Trigger & unlock">
                <ToggleRow icon={ICONS.bolt} color="yellow" checked={s.panicHotkey} onChange={v => settings.store.panicHotkey = v} title="Panic key" subtitle="Instantly covers Discord, press again to unlock." />
                {s.panicHotkey && <KeybindRecorder />}
                <ToggleRow icon={ICONS.eye} color="mint" checked={s.curtainOnBlur} onChange={v => settings.store.curtainOnBlur = v} title="Cover when you click away" subtitle="As soon as another window is active. Clicking back removes it." />
                <ToggleRow
                    icon={ICONS.eyeOff}
                    color="indigo"
                    checked={!s.curtainClickUnlock && s.panicHotkey}
                    disabled={!s.panicHotkey}
                    onChange={v => settings.store.curtainClickUnlock = !v}
                    title="Unlock only with panic key"
                    subtitle={s.panicHotkey ? "A click doesn't remove the curtain – anyone who doesn't know the key can't get in." : "Requires an active panic key."}
                />
            </Section>
        </>
    );
}


// ---------------------------------------------------------------- Streaming & capture

function CurtainButton() {
    const curtain = useCurtainShown();
    const { panicHotkey } = settings.use(["panicHotkey", "panicKey"]);
    return (
        <Section>
            <Row
                leading={<Glyph path={MASK_PATH} color={curtain ? "green" : PRIVACY_COLOR} />}
                title="Activate curtain now"
                subtitle="Covers Discord instantly"
                trailing={panicHotkey ? <Kbd keys={keybindParts(getPanicKey())} /> : undefined}
                onClick={toggleCurtain}
            />
        </Section>
    );
}

function ProtectionTab() {
    const s = settings.use(["contentProtection", "screenshareGuard"]);
    return (
        <>
            {HAS_CONTENT_PROTECTION && (
                <Section title="Screen">
                    <ToggleRow icon={ICONS.camOff} color="red" checked={s.contentProtection} onChange={v => settings.store.contentProtection = v}
                        title="Capture protection" subtitle="Discord is invisible in screenshots, recordings and screen shares – even to your own snipping tool." />
                </Section>
            )}
            <Section title="Streaming">
                <ToggleRow icon={ICONS.cast} color="purple" checked={s.screenshareGuard} onChange={v => settings.store.screenshareGuard = v}
                    title="Streaming protection" subtitle="While you stream or share your screen: DMs blurred, selected servers & channels hidden, notifications muted." />
                <GuardSettings enabled={s.screenshareGuard} />
            </Section>
        </>
    );
}

// ---------------------------------------------------------------- Full UI

type TabId = "curtain" | "protection";

const TABS: { value: TabId; label: string; }[] = [
    { value: "curtain", label: "Curtain" },
    { value: "protection", label: "Streaming & capture" }
];

function PrivacyScreenApp() {
    const { lastTab } = settings.use(["lastTab"]);
    const tab = (TABS.some(t => t.value === lastTab) ? lastTab : "curtain") as TabId;

    return (
        <Sheet
            className={classes(cl("app"), "vc-keep-motion")}
            embedded
            header={{ app: "PrivacyScreen", title: "PrivacyScreen", subtitle: "Panic key, curtain & streaming protection", icon: MASK_PATH, iconColor: PRIVACY_COLOR }}
            top={<Segmented value={tab} options={TABS} onChange={v => settings.store.lastTab = v} />}
        >
            <div key={tab} className={cl("pane")}>
                {tab === "curtain" && <><CurtainButton /><CurtainTab /></>}
                {tab === "protection" && <ProtectionTab />}
            </div>
        </Sheet>
    );
}

export const SettingsPanel = ErrorBoundary.wrap(() => <PrivacyScreenApp />, { noop: true });
