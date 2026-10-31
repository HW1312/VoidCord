/*
 * DoomScroll – control strip above the feed, title bar button & settings
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { findComponentByCodeLazy } from "@webpack";
import { createRoot, Popout, showToast, Tooltip, useEffect, useRef, useState } from "@webpack/common";
import type { Root } from "react-dom/client";

import { Button, Icon as UiIcon, ICONS, Popover, Row, Section, Segmented, Sheet, Slider, strokeIcon, ToggleRow } from "../_ui";
import { closeFeed, DoomState, getState, HANDLE_WIDTH, MIN_CHAT_WIDTH, MIN_SIDE_WIDTH, openFeed, refresh, sideAreaWidth, STRIP_HEIGHT, subscribe } from "./controller";
import { BrandIcon } from "./icons";
import { Native, settings } from "./index";
import { PlatformId, PLATFORMS } from "./platforms";

const cl = classNameFactory("vc-doomscroll-");
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

// ---------------------------------------------------------------- Icons

/** Lucide rounded square (rect 3,3 18×18 rx 2) */
const SQUARE = "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z";
const SPEAKER = "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z";

// Lucide smartphone, arrow-left, volume-2, volume-x, square, panel-right, columns-2
const FEED_PATH = strokeIcon("M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M12 18h.01");
const BACK_PATH = strokeIcon("m12 19-7-7 7-7", "M19 12H5");
const RELOAD_PATH = ICONS.refresh;
const VOLUME_PATH = strokeIcon(SPEAKER, "M16 9a5 5 0 0 1 0 6", "M19.364 18.364a9 9 0 0 0 0-12.728");
const MUTED_PATH = strokeIcon(SPEAKER, "m22 9-6 6", "m16 9 6 6");
const FULL_PATH = strokeIcon(SQUARE);
const CHAT_ONLY_PATH = strokeIcon(SQUARE, "M15 3v18");
const SIDE_PATH = strokeIcon(SQUARE, "M12 3v18");

type Layout = "replace" | "chat" | "side";
const LAYOUTS: { value: Layout; label: string; path: string; }[] = [
    { value: "replace", label: "Cover chat, header & members", path: FULL_PATH },
    { value: "chat", label: "Replace only the chat", path: CHAT_ONLY_PATH },
    { value: "side", label: "Next to the chat", path: SIDE_PATH }
];
const EXTERNAL_PATH = ICONS.external;
const CLOSE_PATH = ICONS.close;

function Icon({ path, size = 20, className }: { path: string; size?: number; className?: string; }) {
    return (
        <UiIcon path={path} size={size} className={classes(cl("icon"), className)} />
    );
}

const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformId[];

function useDoomState() {
    const [s, setS] = useState<DoomState>(getState);
    useEffect(() => subscribe(() => setS(getState())), []);
    return s;
}

// ---------------------------------------------------------------- Overlay (strip + placeholder under the view)

interface TooltipHandlers {
    onMouseEnter(e: React.MouseEvent<HTMLElement>): void;
    onMouseLeave(): void;
}

/**
 * Discord's <Tooltip> renders nothing here: the strip lives in its own React root outside Discord's layer tree.
 * Same look, drawn by us - and opening upwards, since anything below the strip would be behind the feed window.
 */
function StripTooltip({ text, children }: { text: string; children(props: TooltipHandlers): React.ReactNode; }) {
    const [anchor, setAnchor] = useState<DOMRect | null>(null);

    // Near the right edge, align to the button's right side instead of centering
    const nearRight = anchor && anchor.right > window.innerWidth - 90;
    const style: React.CSSProperties | undefined = !anchor ? undefined : (nearRight
        ? { right: window.innerWidth - anchor.right, top: anchor.top - 4 }
        : { left: anchor.left + anchor.width / 2, top: anchor.top - 4 });

    return (
        <>
            {children({
                onMouseEnter: e => setAnchor(e.currentTarget.getBoundingClientRect()),
                onMouseLeave: () => setAnchor(null)
            })}
            {anchor && (
                <div className={classes(cl("tip"), nearRight && cl("tip-right"))} style={style} role="tooltip">
                    {text}
                </div>
            )}
        </>
    );
}

function StripButton({ path, label, onClick, active }: { path: string; label: string; onClick(): void; active?: boolean; }) {
    return (
        <StripTooltip text={label}>
            {({ onMouseEnter, onMouseLeave }) => (
                <button
                    className={classes(cl("strip-btn"), active && cl("strip-btn-active"))}
                    aria-label={label}
                    onClick={onClick}
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                >
                    <Icon path={path} size={18} />
                </button>
            )}
        </StripTooltip>
    );
}

function setMuted(muted: boolean) {
    settings.store.muted = muted;
    Native?.setMuted(muted);
}

function setVolume(volume: number) {
    settings.store.volume = volume;
    Native?.setVolume(volume / 100);
    if (volume > 0 && settings.store.muted) setMuted(false);
}

function VolumeSlider() {
    const { muted, volume } = settings.use(["muted", "volume"]);
    const value = muted ? 0 : volume;
    return (
        <input
            className={cl("volume-slider")}
            type="range"
            min={0}
            max={100}
            step={1}
            value={value}
            aria-label="Volume"
            style={{ "--vc-doomscroll-fill": `${value}%` } as React.CSSProperties}
            onChange={e => setVolume(Number(e.currentTarget.value))}
        />
    );
}

/** Mute button; hovering it slides out a volume slider (like YouTube's player) */
function VolumeControl() {
    const { muted, volume } = settings.use(["muted", "volume"]);
    const label = muted ? "Unmute" : `Mute (${volume}%)`;

    return (
        <div className={cl("volume")}>
            <VolumeSlider />
            <StripTooltip text={label}>
                {({ onMouseEnter, onMouseLeave }) => (
                    <button
                        className={classes(cl("strip-btn"), muted && cl("strip-btn-active"))}
                        aria-label={label}
                        onClick={() => setMuted(!muted)}
                        onMouseEnter={onMouseEnter}
                        onMouseLeave={onMouseLeave}
                    >
                        <Icon path={muted || volume === 0 ? MUTED_PATH : VOLUME_PATH} size={18} />
                    </button>
                )}
            </StripTooltip>
        </div>
    );
}

/** Shows the current layout, click switches to the next one */
function LayoutButton({ layout }: { layout: Layout; }) {
    const index = Math.max(0, LAYOUTS.findIndex(l => l.value === layout));
    const current = LAYOUTS[index];
    const next = LAYOUTS[(index + 1) % LAYOUTS.length];
    return (
        <StripButton
            path={current.path}
            label={`Layout: ${current.label} - click for "${next.label}"`}
            onClick={() => settings.store.layout = next.value}
        />
    );
}

/** Left edge of the side panel: drag to make the feed wider or narrower */
function ResizeHandle() {
    const [dragging, setDragging] = useState(false);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        // Capture keeps the moves coming while the cursor is over the feed window
        e.currentTarget.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startWidth = settings.store.sideWidth;
        const maxWidth = Math.max(MIN_SIDE_WIDTH, sideAreaWidth() - MIN_CHAT_WIDTH);
        const target = e.currentTarget;
        setDragging(true);

        const onMove = (ev: PointerEvent) => {
            const width = Math.round(Math.max(MIN_SIDE_WIDTH, Math.min(maxWidth, startWidth + startX - ev.clientX)));
            if (width === settings.store.sideWidth) return;
            settings.store.sideWidth = width;
            refresh();
        };
        const onUp = () => {
            target.removeEventListener("pointermove", onMove);
            target.removeEventListener("pointerup", onUp);
            target.removeEventListener("pointercancel", onUp);
            setDragging(false);
        };
        target.addEventListener("pointermove", onMove);
        target.addEventListener("pointerup", onUp);
        target.addEventListener("pointercancel", onUp);
    };

    return (
        <div
            className={classes(cl("handle"), dragging && cl("handle-active"))}
            style={{ width: HANDLE_WIDTH }}
            onPointerDown={onPointerDown}
            onDoubleClick={() => {
                settings.store.sideWidth = 420;
                refresh();
            }}
        />
    );
}

function Strip({ platform }: { platform: PlatformId | null; }) {
    const { layout } = settings.use(["layout"]);

    return (
        <div className={cl("strip")} style={{ height: STRIP_HEIGHT }}>
            <div className={cl("tabs")}>
                {PLATFORM_IDS.map(id => (
                    <StripTooltip key={id} text={PLATFORMS[id].name}>
                        {({ onMouseEnter, onMouseLeave }) => (
                            <button
                                className={classes(cl("tab"), platform === id && cl("tab-active"))}
                                aria-label={PLATFORMS[id].name}
                                onClick={() => platform === id ? Native?.focus() : openFeed(id)}
                                onMouseEnter={onMouseEnter}
                                onMouseLeave={onMouseLeave}
                            >
                                <BrandIcon id={id} size={20} />
                            </button>
                        )}
                    </StripTooltip>
                ))}
            </div>
            <div className={cl("actions")}>
                <StripButton path={BACK_PATH} label="Back" onClick={() => Native?.goBack()} />
                <StripButton path={RELOAD_PATH} label="Reload" onClick={() => Native?.reload()} />
                <VolumeControl />
                <LayoutButton layout={layout as Layout} />
                <StripButton path={EXTERNAL_PATH} label="Open in browser" onClick={() => Native?.openExternal()} />
                <StripButton path={CLOSE_PATH} label="Close" onClick={closeFeed} />
            </div>
        </div>
    );
}

function Overlay() {
    const { open, rect, covered, platform } = useDoomState();
    const { layout } = settings.use(["layout"]);
    if (!open || !rect) return null;

    return (
        <div
            className={classes(cl("overlay"), layout === "side" && cl("overlay-side"))}
            style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
            {layout === "side" && <ResizeHandle />}
            <div className={cl("main")}>
                <Strip platform={platform} />
                {/* Only visible while the native view is hidden or still painting */}
                <div className={cl("placeholder")}>
                    {covered ? "Paused" : "Loading …"}
                </div>
            </div>
        </div>
    );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

export function mountRoot() {
    if (root) return;
    host = document.createElement("div");
    host.className = cl("root");
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
        <ErrorBoundary noop>
            <Overlay />
        </ErrorBoundary>
    );
}

export function unmountRoot() {
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
}

// ---------------------------------------------------------------- Title bar button

function PlatformMenu({ onClose }: { onClose(): void; }) {
    const { open, platform } = useDoomState();
    return (
        <Popover className={cl("menu")}>
            {PLATFORM_IDS.map(id => (
                <Tooltip key={id} text={PLATFORMS[id].name}>
                    {({ onMouseEnter, onMouseLeave }) => (
                        <button
                            role="menuitem"
                            aria-label={PLATFORMS[id].name}
                            className={classes(cl("menu-item"), open && platform === id && cl("menu-item-active"))}
                            onClick={() => {
                                onClose();
                                openFeed(id);
                            }}
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                        >
                            <BrandIcon id={id} size={26} />
                        </button>
                    )}
                </Tooltip>
            ))}
        </Popover>
    );
}

function TitleBarButton() {
    const { showTitleBarButton } = settings.use(["showTitleBarButton"]);
    const { open } = useDoomState();
    const buttonRef = useRef(null);
    const [show, setShow] = useState(false);

    if (!showTitleBarButton) return null;

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
                    <PlatformMenu onClose={() => setShow(false)} />
                </ErrorBoundary>
            )}
        >
            {(_, { isShown }) => (
                <HeaderBarIcon
                    ref={buttonRef}
                    className={classes(cl("titlebtn"), open && cl("titlebtn-active"))}
                    onClick={() => setShow(v => !v)}
                    tooltip={isShown ? null : "Doom scroll"}
                    icon={() => <Icon path={FEED_PATH} className="vc-ui-tb-icon" />}
                    selected={isShown || open}
                />
            )}
        </Popout>
    );
}

export function renderTitleBarButton() {
    return (
        <ErrorBoundary key="vc-doomscroll-titlebar" noop>
            <TitleBarButton />
        </ErrorBoundary>
    );
}

// ---------------------------------------------------------------- Settings

type BoolKey = "muted" | "pauseWhenHidden" | "keepLoaded" | "showTitleBarButton";

function Option({ label, setting, onChange }: { label: string; setting: BoolKey; onChange?(v: boolean): void; }) {
    const value = settings.use([setting])[setting];
    return (
        <ToggleRow
            title={label}
            checked={value}
            onChange={v => {
                settings.store[setting] = v;
                onChange?.(v);
            }}
        />
    );
}

function NumberOption({ label, setting, min, max, step, unit, onChange }: {
    label: string; setting: "sideWidth" | "zoom"; min: number; max: number; step: number; unit: string; onChange?(v: number): void;
}) {
    const value = settings.use([setting])[setting];
    return (
        <Row
            title={label}
            trailing={
                <span className={cl("slider")}>
                    <Slider
                        value={value}
                        min={min}
                        max={max}
                        step={step}
                        format={v => `${v}${unit}`}
                        onChange={v => {
                            settings.store[setting] = v;
                            onChange?.(v);
                        }}
                    />
                </span>
            }
        />
    );
}

export const SettingsPanel = ErrorBoundary.wrap(() => {
    const { layout, muted, volume } = settings.use(["layout", "muted", "volume"]);

    return (
        <Sheet embedded header={{ title: "DoomScroll", subtitle: "TikTok, Shorts and Reels right inside Discord", icon: FEED_PATH, iconColor: "gray" }}>
            <Section title="Open a feed">
                {PLATFORM_IDS.map(id => (
                    <Row
                        key={id}
                        leading={<span className={cl("brand-tile")}><BrandIcon id={id} size={18} /></span>}
                        title={PLATFORMS[id].name}
                        chevron
                        onClick={() => openFeed(id)}
                    />
                ))}
            </Section>

            <Section title="Layout">
                <Row
                    title="Layout"
                    trailing={
                        <Segmented<Layout>
                            small
                            value={layout as Layout}
                            options={[{ value: "replace", label: "Cover all" }, { value: "chat", label: "Only the chat" }, { value: "side", label: "Next to chat" }]}
                            onChange={v => settings.store.layout = v}
                        />
                    }
                />
                {layout === "side" && <NumberOption label="Panel width (px) - or drag the feed's left edge" setting="sideWidth" min={MIN_SIDE_WIDTH} max={1600} step={20} unit=" px" onChange={refresh} />}
                <NumberOption label="Feed zoom (%)" setting="zoom" min={50} max={150} step={5} unit="%" onChange={v => Native?.setZoom(v / 100)} />
                <Option label="Show the button in the title bar" setting="showTitleBarButton" />
            </Section>

            <Section title="Playback">
                <Option label="Mute the feed" setting="muted" onChange={v => Native?.setMuted(v)} />
                <Row
                    title="Volume"
                    trailing={
                        <span className={cl("slider")}>
                            <Slider value={muted ? 0 : volume} format={v => `${v}%`} onChange={setVolume} />
                        </span>
                    }
                />
                <Option label="Pause the video while the feed is hidden (menus, modals, closed)" setting="pauseWhenHidden" onChange={v => Native?.setPauseWhenHidden(v)} />
                <Option label="Keep your place in the feed after closing it" setting="keepLoaded" />
            </Section>

            <Section footer="Logins stay saved in a separate browser session. Google may block signing in inside apps - YouTube Shorts works without an account.">
                <Row
                    title="Logins"
                    trailing={
                        <Button
                            variant="destructive"
                            small
                            onClick={async () => {
                                await Native?.clearData();
                                showToast({ text: "Logged out of all feeds", variant: "success" });
                            }}
                        >
                            Log out everywhere
                        </Button>
                    }
                />
            </Section>
        </Sheet>
    );
});
