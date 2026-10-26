/*
 * CallClips – Vencord Userplugin
 * Clip the last seconds of a voice call, like Instant Replay: while you're in a call the plugin keeps the last 15–120 s
 * of sound in memory (the others' voices + your mic while Discord sends it). A shortcut – global, also in games –
 * or the title bar button saves them as a clip in Downloads\Call Clips. The clip list plays, trims, renames, deletes
 * and sends clips into the chat. Sound only, nobody gets told.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { SelectedChannelStore, UserStore } from "@webpack/common";

import { titleBarSlot } from "../_ui";
import { makeClip } from "./clips";
import { MicMode, onSpeaking, start, state, stop as stopRecorder } from "./recorder";
import { renderPanelButton, renderTitleBarButton, SettingsPanel } from "./ui";

const Native = VencordNative.pluginHelpers.CallClips as PluginNative<typeof import("./native")>;
const logger = new Logger("CallClips");

export const settings = definePluginSettings({
    panel: {
        type: OptionType.COMPONENT,
        component: () => <SettingsPanel />
    },
    seconds: {
        type: OptionType.NUMBER,
        description: "Clip length in seconds",
        default: 30,
        hidden: true,
        onChange: restart
    },
    micMode: {
        type: OptionType.STRING,
        description: "Your mic in clips: auto (while Discord sends it), always, never",
        default: "auto" as MicMode,
        hidden: true,
        onChange: restart
    },
    hotkey: {
        type: OptionType.STRING,
        description: "Global shortcut (Electron accelerator)",
        default: "Alt+Shift+C",
        hidden: true
    },
    showTitleBarButton: {
        type: OptionType.BOOLEAN,
        description: "Show icon in the title bar",
        default: true,
        hidden: true
    },
    showPanelButton: {
        type: OptionType.BOOLEAN,
        description: "Show a clip button in the voice panel",
        default: true,
        hidden: true
    }
});

// ---------------------------------------------------------------- Recording only while in a call

let running = false;
let lastFailure = 0;
const RETRY_AFTER = 30_000;

function sync() {
    if (!running) return;
    const inCall = !!SelectedChannelStore.getVoiceChannelId();
    if (inCall && !state.running) {
        // Don't retry a failed start on every voice event
        if (state.error && Date.now() - lastFailure < RETRY_AFTER) return;
        const { seconds, micMode } = settings.store;
        start(seconds, micMode !== "never").then(() => {
            if (state.error) lastFailure = Date.now();
            // Left the call while starting
            if (!SelectedChannelStore.getVoiceChannelId()) stopRecorder();
        });
    } else if (!inCall && state.running) {
        stopRecorder();
    }
}

/** Stores update after the event – look a moment later */
const syncSoon = () => void setTimeout(sync, 300);

function restart() {
    if (!state.running) return;
    stopRecorder();
    sync();
}

let pollId: ReturnType<typeof setInterval> | undefined;

// ---------------------------------------------------------------- Shortcut

export async function applyHotkey(accelerator = settings.store.hotkey) {
    try {
        return await Native.setHotkey(accelerator);
    } catch (e) {
        logger.error("Could not set the shortcut", e);
        return false;
    }
}

// ---------------------------------------------------------------- Plugin

export default definePlugin({
    name: "CallClips",
    description: "Clip the last seconds of a voice call with a shortcut – saved as audio, with a list to play, trim, rename and send clips",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Voice", "Media", "Utility"],
    settings,

    patches: [
        {
            // Left side of the title bar, like the other VoidCord plugins
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /(leading:.{0,2500}?)\]\}\),title:/,
                replace: "$1,$self.renderTitleBarButton()]}),title:"
            }
        },
        {
            // Voice panel at the bottom left: before noise suppression and disconnect
            find: '"krisp-popout"',
            replacement: {
                match: /(className:\i\.\i,children:\[)(?=\i&&!\i\?\(0,\i\.jsx\)\(\i,\{channel:\i\}\):null,\(0,\i\.jsx\)\(\i,\{channel:\i\}\)\])/,
                replace: "$1$self.renderPanelButton(),"
            }
        }
    ],

    renderTitleBarButton: titleBarSlot("CallClips", renderTitleBarButton),
    renderPanelButton,

    /** Called by the global shortcut (main process) */
    onHotkey() {
        void makeClip();
    },

    flux: {
        VOICE_CHANNEL_SELECT: syncSoon,
        RTC_CONNECTION_STATE: syncSoon,
        SPEAKING({ userId, speakingFlags, context }: { userId: string; speakingFlags: number; context?: string; }) {
            if (context && context !== "default") return;
            if (userId !== UserStore.getCurrentUser()?.id) return;
            // Flag 2 is stream sound, not your mic
            onSpeaking((speakingFlags & ~2) !== 0);
        }
    },

    start() {
        running = true;
        void applyHotkey();
        sync();
        // Safety net in case a voice event is missed
        pollId = setInterval(sync, 10_000);
    },

    stop() {
        running = false;
        clearInterval(pollId);
        Native.clearHotkey().catch(() => { });
        stopRecorder();
    }
});
