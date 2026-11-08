/*
 * PrivacyScreen – Vencord Userplugin
 * Panic key + privacy curtain (covers Discord instantly, also when you click away), capture protection
 * (Discord invisible in screenshots / recordings) and streaming protection (blur DMs, hide servers & channels,
 * mute notifications while you stream). Split out of OpSec – its settings are taken over once on first start.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, SettingsStore } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";

import { configureCurtain, CurtainAnimation, CurtainIconName, CurtainOptions, CurtainStyle, hideCurtain, showCurtain, toggleCurtain } from "./curtain";
import { DEFAULT_KEYBIND, formatKeybind, matchesKeybind, parseKeybind, recording } from "./keybind";
import { configureGuard, evaluateStream, onOwnStreamStart, refreshGuard, stopGuard } from "./stream";
import { SettingsPanel } from "./ui";

const Native = VencordNative.pluginHelpers.PrivacyScreen as PluginNative<typeof import("./native")>;
const logger = new Logger("PrivacyScreen");

let running = false;

// ---------------------------------------------------------------- One-time takeover from OpSec

/** Settings that moved from OpSec unchanged (same names) */
const MOVED_KEYS = [
    "panicKey",
    "guardNotifications", "guardBlurDms", "guardRevealOnHover", "guardStreamerMode", "guardHiddenGuilds", "guardHiddenChannels",
    "curtainStyle", "curtainAnimation", "curtainOpacity", "curtainBlur", "curtainAccent", "curtainShowIcon", "curtainIcon",
    "curtainIconCustom", "curtainShowText", "curtainText", "curtainClickUnlock"
];

/** The four switches OpSec had in its profiles – with the values its profiles gave them */
const SWITCHES = ["contentProtection", "curtainOnBlur", "panicHotkey", "screenshareGuard"] as const;
const OPSEC_PRESETS: Record<"standard" | "paranoid", Record<typeof SWITCHES[number], boolean>> = {
    standard: { contentProtection: false, curtainOnBlur: false, panicHotkey: true, screenshareGuard: true },
    paranoid: { contentProtection: true, curtainOnBlur: true, panicHotkey: true, screenshareGuard: true }
};

/*
 * Runs at import, before plugins start (like Vencord's migratePluginSettings): writes the plain settings object,
 * so the enabled state taken from OpSec already counts for this start. Values are JSON-copied – never the proxies.
 */
function takeOverFromOpSec() {
    try {
        const { plugins } = SettingsStore.plain;
        const mine = plugins.PrivacyScreen;
        if (mine?.migratedFromOpSec) return;

        const next: Record<string, any> = JSON.parse(JSON.stringify(mine ?? {}));
        const old = plugins.OpSec;
        if (old) {
            for (const key of MOVED_KEYS) if (old[key] !== undefined) next[key] = JSON.parse(JSON.stringify(old[key]));
            const profile = old.profile ?? "standard";
            const preset = OPSEC_PRESETS[profile as "standard" | "paranoid"] ?? OPSEC_PRESETS.standard;
            for (const key of SWITCHES) {
                next[key] = profile === "custom" && typeof old[key] === "boolean" ? old[key] : preset[key];
            }
            next.enabled = !!old.enabled;
            logger.info("Took over the panic key, curtain and streaming protection settings from OpSec");
        } else if (next.enabled === undefined) {
            next.enabled = false;
        }
        next.migratedFromOpSec = true;
        plugins.PrivacyScreen = next as typeof plugins[string];
        SettingsStore.markAsChanged();
    } catch (e) {
        logger.error("Taking over the settings from OpSec failed", e);
    }
}

takeOverFromOpSec();

// ---------------------------------------------------------------- Settings

const apply = () => scheduleApply();

export const settings = definePluginSettings({
    panel: {
        type: OptionType.COMPONENT,
        component: () => <SettingsPanel />
    },
    // Switches
    panicHotkey: { type: OptionType.BOOLEAN, description: "Panic key", default: true, hidden: true },
    curtainOnBlur: { type: OptionType.BOOLEAN, description: "Cover when you click away", default: false, hidden: true, onChange: apply },
    contentProtection: { type: OptionType.BOOLEAN, description: "Capture protection", default: false, hidden: true, onChange: apply },
    screenshareGuard: { type: OptionType.BOOLEAN, description: "Streaming protection", default: true, hidden: true, onChange: apply },
    panicKey: { type: OptionType.STRING, description: "Panic key combination", default: DEFAULT_KEYBIND, hidden: true },
    // Streaming protection
    guardNotifications: { type: OptionType.BOOLEAN, description: "Mute notifications", default: true, hidden: true, onChange: apply },
    guardBlurDms: { type: OptionType.BOOLEAN, description: "Blur DMs", default: true, hidden: true, onChange: apply },
    guardRevealOnHover: { type: OptionType.BOOLEAN, description: "Reveal on hover", default: false, hidden: true, onChange: apply },
    guardStreamerMode: { type: OptionType.BOOLEAN, description: "Streamer Mode", default: false, hidden: true, onChange: apply },
    /** Server IDs, comma-separated */
    guardHiddenGuilds: { type: OptionType.STRING, description: "Hidden servers", default: "", hidden: true, onChange: apply },
    /** Channel IDs, comma-separated */
    guardHiddenChannels: { type: OptionType.STRING, description: "Hidden channels", default: "", hidden: true, onChange: apply },
    // Curtain appearance
    curtainStyle: { type: OptionType.STRING, description: "Style", default: "mask" as CurtainStyle, hidden: true },
    curtainAnimation: { type: OptionType.STRING, description: "Animation", default: "zoom" as CurtainAnimation, hidden: true },
    curtainOpacity: { type: OptionType.NUMBER, description: "Opacity", default: 94, hidden: true },
    curtainBlur: { type: OptionType.NUMBER, description: "Blur", default: 24, hidden: true },
    curtainAccent: { type: OptionType.STRING, description: "Accent color", default: "#3ddc97", hidden: true },
    curtainShowIcon: { type: OptionType.BOOLEAN, description: "Show icon", default: true, hidden: true },
    curtainIcon: { type: OptionType.STRING, description: "Icon", default: "eyeOff" as CurtainIconName, hidden: true },
    curtainIconCustom: { type: OptionType.STRING, description: "Custom icon (emoji or image link)", default: "", hidden: true },
    curtainShowText: { type: OptionType.BOOLEAN, description: "Show text", default: true, hidden: true },
    curtainText: { type: OptionType.STRING, description: "Text", default: "", hidden: true },
    curtainClickUnlock: { type: OptionType.BOOLEAN, description: "Click to unlock", default: true, hidden: true },
    /** Last opened tab in the settings */
    lastTab: { type: OptionType.STRING, description: "internal", default: "curtain", hidden: true },
    /** Settings were taken over from OpSec once (or there was nothing to take over) */
    migratedFromOpSec: { type: OptionType.BOOLEAN, description: "internal", default: false, hidden: true }
});

export const getPanicKey = () => parseKeybind(settings.store.panicKey);

// ---------------------------------------------------------------- ID lists (streaming protection)

type IdListKey = "guardHiddenGuilds" | "guardHiddenChannels";

export const getIdList = (key: IdListKey) => (settings.store[key] || "").split(",").filter(Boolean);

export function toggleId(key: IdListKey, id: string, on: boolean) {
    setIds(key, [id], on);
}

export function setIds(key: IdListKey, idsToSet: string[], on: boolean) {
    const ids = new Set(getIdList(key));
    for (const id of idsToSet) {
        if (on) ids.add(id);
        else ids.delete(id);
    }
    settings.store[key] = [...ids].join(",");
}

configureGuard(() => {
    const s = settings.store;
    return {
        enabled: running && s.screenshareGuard,
        notifications: s.guardNotifications,
        blurDms: s.guardBlurDms,
        revealOnHover: s.guardRevealOnHover,
        streamerMode: s.guardStreamerMode,
        hiddenGuilds: getIdList("guardHiddenGuilds"),
        hiddenChannels: getIdList("guardHiddenChannels")
    };
});

export function getCurtainOptions(): CurtainOptions {
    const s = settings.store;
    return {
        style: s.curtainStyle as CurtainStyle,
        animation: s.curtainAnimation as CurtainAnimation,
        opacity: s.curtainOpacity,
        blur: s.curtainBlur,
        accent: s.curtainAccent,
        showIcon: s.curtainShowIcon,
        icon: s.curtainIcon as CurtainIconName,
        iconCustom: s.curtainIconCustom,
        showText: s.curtainShowText,
        text: s.curtainText,
        // Without a panic key a click must always unlock – otherwise you lock yourself out
        clickToUnlock: s.curtainClickUnlock || !s.panicHotkey,
        hotkeyLabel: s.panicHotkey ? formatKeybind(getPanicKey()) : "the panic key"
    };
}

configureCurtain(getCurtainOptions);

// ---------------------------------------------------------------- Applying

let applyQueued = false;
function scheduleApply() {
    if (applyQueued) return;
    applyQueued = true;
    queueMicrotask(() => {
        applyQueued = false;
        applyRuntime();
    });
}

let contentProtectionActive: boolean | null = null;

function applyRuntime() {
    if (!running) return;
    setContentProtection(settings.store.contentProtection);
    if (!settings.store.curtainOnBlur) hideCurtain(true);
    refreshGuard();
}

function setContentProtection(on: boolean) {
    if (on === contentProtectionActive) return;
    contentProtectionActive = on;
    Native.setContentProtection(on).catch(e => logger.error("Failed to set capture protection", e));
}

// ---------------------------------------------------------------- Privacy curtain

function onKeyDown(e: KeyboardEvent) {
    if (!recording.active && settings.store.panicHotkey && matchesKeybind(e, getPanicKey())) {
        e.preventDefault();
        e.stopPropagation();
        toggleCurtain();
    }
}

let blurTimer: ReturnType<typeof setTimeout> | undefined;

function onWindowBlur() {
    clearTimeout(blurTimer);
    // Wait briefly: focus inside an embedded video (iframe) doesn't count as "gone"
    blurTimer = setTimeout(() => {
        if (settings.store.curtainOnBlur && !document.hasFocus()) showCurtain("auto");
    }, 150);
}

function onWindowFocus() {
    clearTimeout(blurTimer);
    hideCurtain(true);
}

// ---------------------------------------------------------------- Plugin

export default definePlugin({
    name: "PrivacyScreen",
    description: "Panic key that covers Discord instantly (also when you click away), capture protection and streaming protection that blurs DMs and hides servers while you stream",
    about: "Covers Discord with one key press – or automatically when you click away – hides it from screenshots and recordings, and while you stream it blurs your DMs, hides the servers you pick and mutes notifications.",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Privacy", "Utility"],
    settings,

    flux: {
        // Like the stock plugin "StreamerModeOnStream"; STREAM_START only fires for your own stream
        STREAM_START() {
            if (running) onOwnStreamStart();
        },
        STREAM_CREATE() {
            if (running) evaluateStream();
        },
        STREAM_DELETE() {
            if (running) evaluateStream();
        },
        STREAM_STOP() {
            if (running) evaluateStream();
        }
    },

    toolboxActions: {
        "Toggle privacy curtain": () => toggleCurtain()
    },

    start() {
        running = true;
        contentProtectionActive = null;
        applyRuntime();

        document.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("blur", onWindowBlur);
        window.addEventListener("focus", onWindowFocus);
    },

    stop() {
        running = false;

        stopGuard();
        setContentProtection(false);
        hideCurtain();

        document.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("blur", onWindowBlur);
        window.removeEventListener("focus", onWindowFocus);
        clearTimeout(blurTimer);
    }
});
