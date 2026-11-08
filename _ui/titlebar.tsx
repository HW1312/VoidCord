/*
 * _ui – Title bar of all VoidCord plugins: every plugin's icon sits in a slot with a fixed id, so the user can
 * arrange them by drag & drop (right-click an icon or the back / forward arrows → "Arrange icons" → drag → Save).
 * Empty spots of the title bar don't work: they drag the window, Windows shows its own menu there.
 * Works with ToolbarManager on or off: the order is set with CSS `order` on the slots, which wins over its own.
 *
 * Also keeps the title bar from getting squeezed: when the icons would run into Discord's centered title
 * ("Direct Messages", the channel name …), that title is hidden.
 *
 * Showing / hiding icons is also here, for all plugins at once: right-click → "Show icons" → tick them. A hidden
 * icon's slot stays mounted (display: none), so it can be listed and shown again. This replaced each plugin's own
 * "Show icon in the title bar" setting – an icon that was turned off there starts hidden here (one-time migration).
 *
 * Usage in a plugin: `renderTitleBarButton: titleBarSlot("FriendDock", renderTitleBarButton)`
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Settings } from "@api/Settings";
import { ContextMenuApi, createRoot, Menu, useEffect, useReducer } from "@webpack/common";
import type { ReactNode } from "react";

import { Button, cl } from "./index";

const ATTR = "data-vc-tb";
const STORE_KEY = "VoidCord_titleBar";
/** Saved slots come first (in this order), new ones after them */
const ORDER_BASE = 1000;

let order: string[] = [];
/** Slots the user hid */
let hidden: string[] = [];
/** While arranging: the order shown, saved only with Save */
let draft: string[] | null = null;
let initialized = false;

/** Slot id → plugin name, where they differ (label in the menu and the old setting's plugin) */
const PLUGIN_NAMES: Record<string, string> = { SecretChat: "Unter das OS", opsec: "OpSec" };
const pluginName = (id: string) => PLUGIN_NAMES[id] ?? id;
/** Every slot a plugin registered (also of disabled plugins – only mounted ones are listed) */
const registered = new Set<string>();

const save = () => DataStore.set(STORE_KEY, { order, hidden, migrated: true }).catch(() => { });

/** One time: icons turned off with the old per-plugin setting start hidden */
function migrateOldSetting() {
    for (const id of registered) {
        if ((Settings.plugins as any)[pluginName(id)]?.showTitleBarButton === false && !hidden.includes(id)) hidden.push(id);
    }
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

// ---------------------------------------------------------------- Order (generated CSS)

let styleEl: HTMLStyleElement | null = null;

function applyOrder() {
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "vc-ui-titlebar-order";
        document.head.appendChild(styleEl);
    }
    const list = draft ?? order;
    styleEl.textContent = [
        `[${ATTR}] { order: ${ORDER_BASE + 500} !important; }`,
        ...list.map((id, i) => `[${ATTR}="${CSS.escape(id)}"] { order: ${ORDER_BASE + i} !important; }`),
        ...hidden.map(id => `[${ATTR}="${CSS.escape(id)}"] { display: none !important; }`)
    ].join("\n");
    queueMicrotask(checkSqueeze);
}

async function init() {
    if (initialized) return;
    initialized = true;
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("resize", checkSqueeze);
    try {
        const saved = await DataStore.get<{ order?: string[]; hidden?: string[]; migrated?: boolean; }>(STORE_KEY);
        order = saved?.order ?? [];
        hidden = saved?.hidden ?? [];
        if (!saved?.migrated) {
            migrateOldSetting();
            save();
        }
    } catch { }
    applyOrder();
}

function toggleHidden(id: string) {
    hidden = hidden.includes(id) ? hidden.filter(h => h !== id) : [...hidden, id];
    save();
    applyOrder();
}

// ---------------------------------------------------------------- Finding the title bar

const slots = () => Array.from(document.querySelectorAll<HTMLElement>(`[${ATTR}]`));
/** Slots on screen (not hidden) – the ones that can be arranged */
const visibleSlots = () => slots().filter(s => !hidden.includes(s.getAttribute(ATTR)!));

/** The container all slots sit in (the left part of the title bar) */
const leadingContainer = () => slots()[0]?.parentElement ?? null;

/** The whole title bar: the first ancestor about as wide as the window */
function titleBar() {
    let el = leadingContainer();
    while (el && el.getBoundingClientRect().width < window.innerWidth * 0.9) el = el.parentElement;
    return el;
}

// ---------------------------------------------------------------- Squeeze: hide Discord's title when the icons reach it

let titleWidth = 0;

/** Discord's centered title: the element in the bar (not the left or right part) that sits around the middle */
function findTitle(bar: HTMLElement, leading: HTMLElement) {
    const mid = window.innerWidth / 2;
    const centered = Array.from(bar.querySelectorAll<HTMLElement>("*")).filter(el => {
        if (el.contains(leading) || leading.contains(el) || el.querySelector("button") || !el.textContent?.trim()) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.left < mid && r.right > mid && r.width < window.innerWidth * 0.6;
    });
    // The outermost of them – icon and text together
    return centered.find(el => !centered.some(o => o !== el && o.contains(el))) ?? null;
}

function checkSqueeze() {
    const leading = leadingContainer();
    const bar = titleBar();
    if (!leading || !bar) return;
    const title = (bar.querySelector<HTMLElement>("[data-vc-tb-title]") ?? findTitle(bar, leading));
    if (!title) return;
    title.setAttribute("data-vc-tb-title", "");

    const hidden = title.hasAttribute("data-vc-tb-squeezed");
    if (!hidden) titleWidth = title.getBoundingClientRect().width;
    let right = leading.getBoundingClientRect().left;
    for (const c of Array.from(leading.children)) right = Math.max(right, c.getBoundingClientRect().right);
    // The title is centered – compare with where it starts (also while hidden, from its last width)
    const titleLeft = bar.getBoundingClientRect().left + bar.getBoundingClientRect().width / 2 - titleWidth / 2;
    const squeezed = right + 12 > titleLeft;
    if (squeezed !== hidden) title.toggleAttribute("data-vc-tb-squeezed", squeezed);
}

let barObserver: ResizeObserver | null = null;
let observedBar: Element | null = null;

function watchBar() {
    const bar = titleBar();
    if (!bar || bar === observedBar) return;
    barObserver?.disconnect();
    barObserver = new ResizeObserver(checkSqueeze);
    barObserver.observe(bar);
    const leading = leadingContainer();
    if (leading) barObserver.observe(leading);
    observedBar = bar;
}

// ---------------------------------------------------------------- Slot

function TitleBarSlot({ id, render }: { id: string; render(): ReactNode; }) {
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
        listeners.add(rerender);
        // A new icon can push the icons into the title
        requestAnimationFrame(() => { watchBar(); checkSqueeze(); });
        return () => void listeners.delete(rerender);
    }, []);
    return (
        <div {...{ [ATTR]: id }} className={cl("tb-slot")}>
            {render()}
        </div>
    );
}

/** Wraps a plugin's title bar button so it can be arranged; `id` must stay the same (it's saved) */
export function titleBarSlot(id: string, render: () => ReactNode) {
    registered.add(id);
    init();
    return () => <TitleBarSlot key={`vc-ui-tb-${id}`} id={id} render={render} />;
}

// ---------------------------------------------------------------- Right-click → Arrange

/** Bubbling phase: icons with their own menu (ToolbarManager, the lock …) already handled it and stopped it */
function onContextMenu(e: MouseEvent) {
    if (draft || e.defaultPrevented || !(e.target instanceof Element)) return;
    const leading = leadingContainer();
    if (!leading || !leading.contains(e.target)) return;
    e.preventDefault();
    // Plugins that are on right now (their slot is mounted), by name
    const ids = [...new Set(slots().map(s => s.getAttribute(ATTR)!))].sort((a, b) => pluginName(a).localeCompare(pluginName(b)));
    ContextMenuApi.openContextMenu(e as any, () => <TitleBarMenu ids={ids} />);
}

function TitleBarMenu({ ids }: { ids: string[]; }) {
    // Re-render the ticks right away when one is clicked (the menu stays open)
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    return (
        <Menu.Menu navId="vc-ui-titlebar" onClose={ContextMenuApi.closeContextMenu} aria-label="Title bar">
            <Menu.MenuItem id="vc-ui-tb-arrange" label="Arrange icons" action={startArranging} />
            {order.length > 0 && <Menu.MenuItem id="vc-ui-tb-reset" label="Reset icon order" action={resetOrder} />}
            {ids.length > 0 && (
                <Menu.MenuItem id="vc-ui-tb-show" label="Show icons">
                    {ids.map(id => (
                        <Menu.MenuCheckboxItem
                            key={id}
                            id={`vc-ui-tb-show-${id}`}
                            label={pluginName(id)}
                            checked={!hidden.includes(id)}
                            action={() => { toggleHidden(id); rerender(); }}
                        />
                    ))}
                </Menu.MenuItem>
            )}
        </Menu.Menu>
    );
}

/** The order as it is on screen right now */
const visualOrder = () => visibleSlots()
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
    .map(el => el.getAttribute(ATTR)!);

// ---------------------------------------------------------------- Arranging

let barRoot: ReturnType<typeof createRoot> | null = null;

export function startArranging() {
    if (draft) return;
    draft = visualOrder();
    document.documentElement.classList.add("vc-ui-tb-arranging");
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("click", blockClick, true);
    window.addEventListener("keydown", onKey, true);
    applyOrder();
    const host = document.createElement("div");
    host.id = "vc-ui-tb-arrange-host";
    document.body.appendChild(host);
    barRoot = createRoot(host);
    barRoot.render(<ArrangeBar />);
    emit();
}

function stopArranging(keep: boolean) {
    if (!draft) return;
    if (keep) {
        // Hidden icons weren't arranged – they keep their old place among the others
        const merged = [...draft];
        order.forEach((id, i) => { if (hidden.includes(id) && !merged.includes(id)) merged.splice(Math.min(i, merged.length), 0, id); });
        order = merged;
        save();
    }
    draft = null;
    document.documentElement.classList.remove("vc-ui-tb-arranging");
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("click", blockClick, true);
    window.removeEventListener("keydown", onKey, true);
    barRoot?.unmount();
    barRoot = null;
    document.getElementById("vc-ui-tb-arrange-host")?.remove();
    applyOrder();
    emit();
}

function resetOrder() {
    order = [];
    save();
    applyOrder();
}

function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.stopPropagation(); stopArranging(false); }
    if (e.key === "Enter") { e.stopPropagation(); stopArranging(true); }
}

/** No clicks on the icons while arranging (they would open their windows) */
function blockClick(e: MouseEvent) {
    if (e.target instanceof Element && e.target.closest(`[${ATTR}]`)) {
        e.preventDefault();
        e.stopPropagation();
    }
}

function onPointerDown(e: PointerEvent) {
    const slot = e.target instanceof Element ? e.target.closest<HTMLElement>(`[${ATTR}]`) : null;
    if (!slot || e.button !== 0 || !draft) return;
    e.preventDefault();
    e.stopPropagation();

    const id = slot.getAttribute(ATTR)!;
    const rect = slot.getBoundingClientRect();
    const grab = e.clientX - rect.left;
    let shift = 0;
    slot.classList.add(cl("tb-dragging"));

    const move = (ev: PointerEvent) => {
        if (!draft) return;
        // Where the slot would be without the drag offset
        const layoutLeft = slot.getBoundingClientRect().left - shift;
        shift = ev.clientX - grab - layoutLeft;
        slot.style.transform = `translateX(${shift}px)`;

        // Swap with a neighbour once the dragged icon's middle passes the neighbour's middle
        const middle = ev.clientX - grab + rect.width / 2;
        const others = visibleSlots().filter(s => s !== slot);
        let index = 0;
        for (const o of others) {
            const r = o.getBoundingClientRect();
            if (r.left + r.width / 2 < middle) index++;
        }
        const ids = visualOrderWithout(others);
        ids.splice(index, 0, id);
        if (ids.join() !== draft.join()) {
            draft = ids;
            applyOrder();
            // The slot moved in the layout – keep it under the pointer
            const newLeft = slot.getBoundingClientRect().left - shift;
            shift = ev.clientX - grab - newLeft;
            slot.style.transform = `translateX(${shift}px)`;
        }
    };
    const up = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", up, true);
        slot.classList.remove(cl("tb-dragging"));
        // Glide into its place
        slot.style.transition = "transform 0.25s var(--vc-ui-spring)";
        slot.style.transform = "";
        setTimeout(() => { slot.style.transition = ""; }, 260);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
}

/** The other slots' ids in their current draft order */
function visualOrderWithout(others: HTMLElement[]) {
    const ids = new Set(others.map(o => o.getAttribute(ATTR)!));
    const inDraft = (draft ?? []).filter(i => ids.has(i));
    // Slots that appeared while arranging go at the end
    for (const i of ids) if (!inDraft.includes(i)) inDraft.push(i);
    return inDraft;
}

function ArrangeBar() {
    return (
        <div className={cl("tb-arrange")}>
            <span className={cl("tb-arrange-text")}>Drag the icons to arrange them</span>
            <Button small variant="gray" onClick={() => stopArranging(false)}>Cancel</Button>
            <Button small onClick={() => stopArranging(true)}>Save position</Button>
        </div>
    );
}
