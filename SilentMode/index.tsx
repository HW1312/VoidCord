/*
 * SilentMode – Vencord Userplugin
 * One switch for going quiet: no typing indicator, every message sent silently (no push / sound), no reply pings,
 * DM and group calls without ringing, own messages overwritten with gibberish before they are deleted,
 * invisible status and hidden activity.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, MessageStore, RestAPI, UserStore } from "@webpack/common";

import { titleBarSlot } from "../_ui";
import { renderTitleBarButton, SettingsPanel } from "./ui";

const logger = new Logger("SilentMode");

const StatusSetting = getUserSettingLazy<string>("status", "status")!;
const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;

let running = false;

// ---------------------------------------------------------------- Settings

const feature = (description: string) => ({
    type: OptionType.BOOLEAN as const,
    description,
    default: true,
    hidden: true
});

export const settings = definePluginSettings({
    panel: {
        type: OptionType.COMPONENT,
        component: () => <SettingsPanel />
    },
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Silent Mode is on",
        default: false,
        hidden: true,
        onChange: () => applyPresence()
    },
    typing: feature("Hide that you are typing"),
    messages: feature("Send every message silently (no push notification, no sound)"),
    replyPing: feature("Don't ping the person you reply to"),
    calls: feature("Start DM and group calls without ringing anyone"),
    deletes: feature("Overwrite your messages with gibberish before deleting them"),
    invisible: { ...feature("Appear invisible"), onChange: () => applyPresence() },
    activity: { ...feature("Hide your game and app activity"), onChange: () => applyPresence() },
    showTitleBarButton: {
        type: OptionType.BOOLEAN,
        description: "Show icon in the title bar",
        default: true,
        hidden: true
    },
    /** Status before Silent Mode set "invisible" – restored when it ends */
    savedStatus: {
        type: OptionType.STRING,
        description: "",
        default: "",
        hidden: true
    },
    /** Silent Mode turned "Share detected activities" off and turns it back on when it ends */
    savedShowGame: {
        type: OptionType.BOOLEAN,
        description: "",
        default: false,
        hidden: true
    }
});

type Feature = "typing" | "messages" | "replyPing" | "calls" | "deletes" | "invisible" | "activity";

const on = (key: Feature) => running && settings.store.enabled && settings.store[key];

export function toggleSilentMode() {
    settings.store.enabled = !settings.store.enabled;
}

// ---------------------------------------------------------------- Status & activity

function applyPresence() {
    const s = settings.store;
    try {
        if (on("invisible")) {
            const current = StatusSetting.getSetting();
            if (current && current !== "invisible") {
                s.savedStatus = current;
                StatusSetting.updateSetting("invisible");
            }
        } else if (s.savedStatus) {
            // Only if nobody changed the status in the meantime
            if (StatusSetting.getSetting() === "invisible") StatusSetting.updateSetting(s.savedStatus);
            s.savedStatus = "";
        }

        if (on("activity")) {
            if (ShowCurrentGame.getSetting()) {
                s.savedShowGame = true;
                ShowCurrentGame.updateSetting(false);
            }
        } else if (s.savedShowGame) {
            ShowCurrentGame.updateSetting(true);
            s.savedShowGame = false;
        }
    } catch (e) {
        logger.error("Could not change status / activity", e);
    }
}

// ---------------------------------------------------------------- Requests to Discord

const TYPING_URL = /\/channels\/\d+\/typing(?:$|[?#])/;
const SEND_URL = /\/channels\/\d+\/messages(?:$|[?#])/;
const RING_URL = /\/channels\/(\d+)\/call\/ring(?:$|[?#])/;
const MESSAGE_URL = /\/channels\/(\d+)\/messages\/(\d+)(?:$|[?#])/;

const SUPPRESS_NOTIFICATIONS = 1 << 12;
const CHANNEL_DM = 1;
const CHANNEL_GROUP_DM = 3;
/** Message types that can be edited: normal messages and replies */
const EDITABLE_TYPES = new Set([0, 19]);

/** What Discord answers to typing / ring requests (204 No Content) – handed back instead of sending them */
const fakeNoContent = () => Promise.resolve({ ok: true, status: 204, body: null, headers: {}, text: "" });

const urlOf = (req: any): string => (typeof req === "string" ? req : typeof req?.url === "string" ? req.url : "");

/*
 * Starting a call sends its own POST /channels/<id>/call/ring right after joining. Only that automatic ring is
 * dropped: it must come shortly after joining the channel's call and must not name specific users
 * ("Ring" on a single person later still goes through).
 */
const AUTO_RING_WINDOW = 15_000;
const joinedCalls = new Map<string, number>();

function isAutoRing(channelId: string, req: any) {
    const joined = joinedCalls.get(channelId);
    joinedCalls.delete(channelId);
    if (joined === undefined || Date.now() - joined > AUTO_RING_WINDOW) return false;
    if (Array.isArray(req?.body?.recipients) && req.body.recipients.length) return false;
    const type = ChannelStore.getChannel(channelId)?.type;
    return type === CHANNEL_DM || type === CHANNEL_GROUP_DM;
}

function silenceMessage(req: any) {
    const body = req?.body;
    if (!body || typeof body !== "object") return;

    if (on("messages")) body.flags = (body.flags ?? 0) | SUPPRESS_NOTIFICATIONS;

    if (on("replyPing") && body.message_reference) {
        // Without allowed_mentions Discord pings the replied user, so set Discord's defaults minus that ping
        body.allowed_mentions = { parse: ["users", "roles", "everyone"], ...body.allowed_mentions, replied_user: false };
    }
}

const GIBBERISH = "abcdefghijklmnopqrstuvwxyz";

function gibberish() {
    const words: string[] = [];
    const count = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
        let word = "";
        const length = 2 + Math.floor(Math.random() * 7);
        for (let j = 0; j < length; j++) word += GIBBERISH[Math.floor(Math.random() * GIBBERISH.length)];
        words.push(word);
    }
    return words.join(" ");
}

/** Own message about to be deleted: edit it to gibberish first, so loggers that only keep the last text get that */
async function overwriteBeforeDelete(req: any) {
    const match = urlOf(req).match(MESSAGE_URL);
    if (!match) return;

    const [, channelId, messageId] = match;
    const message = MessageStore.getMessage(channelId, messageId);
    if (!message || message.author?.id !== UserStore.getCurrentUser()?.id || !EDITABLE_TYPES.has(message.type)) return;

    try {
        await RestAPI.patch({
            url: `/channels/${channelId}/messages/${messageId}`,
            body: { content: gibberish() }
        });
    } catch (e) {
        // Deleting still matters more than the overwrite
        logger.warn("Could not overwrite the message before deleting it", e);
    }
}

type RequestFn = (req: any, ...rest: any[]) => Promise<any>;
/** Discord's own functions; kept while another plugin wrapped on top of ours (see unwrapRequests) */
let originals: { post: RequestFn; del: RequestFn; } | null = null;

function wrappedPost(this: any, req: any, ...rest: any[]) {
    if (running && settings.store.enabled) {
        const url = urlOf(req);
        if (on("typing") && TYPING_URL.test(url)) return fakeNoContent();
        if (SEND_URL.test(url)) silenceMessage(req);
        const ring = url.match(RING_URL);
        if (ring && on("calls") && isAutoRing(ring[1], req)) return fakeNoContent();
    }
    return originals!.post.call(this, req, ...rest);
}

async function wrappedDel(this: any, req: any, ...rest: any[]) {
    if (on("deletes")) await overwriteBeforeDelete(req);
    return originals!.del.call(this, req, ...rest);
}

function wrapRequests() {
    // Still installed from before: the wrappers only act while running
    if (originals) return;
    originals = { post: RestAPI.post, del: RestAPI.del };
    RestAPI.post = wrappedPost;
    RestAPI.del = wrappedDel;
}

function unwrapRequests() {
    // Only restore when nobody (e.g. VoiceLength) wrapped on top of us, else we would remove their wrapper too
    if (!originals || RestAPI.post !== wrappedPost || RestAPI.del !== wrappedDel) return;
    RestAPI.post = originals.post;
    RestAPI.del = originals.del;
    originals = null;
}

// ---------------------------------------------------------------- Plugin

export default definePlugin({
    name: "SilentMode",
    description: "One switch to go quiet: no typing indicator, silent messages, no reply pings, calls without ringing, deleted messages overwritten first, invisible and no activity",
    about: "One switch to go quiet: no typing indicator, messages without push notifications, replies without pings, calls without ringing, invisible status and no activity. Deleted messages are overwritten with gibberish first.",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Privacy", "Chat", "Voice"],
    settings,

    patches: [
        {
            // Title bar on the left (next to Back/Forward & Inbox): append the button at the end
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /(leading:.{0,2500}?)\]\}\),title:/,
                replace: "$1,$self.renderTitleBarButton()]}),title:"
            }
        }
    ],

    renderTitleBarButton: titleBarSlot("SilentMode", renderTitleBarButton),

    flux: {
        VOICE_CHANNEL_SELECT({ channelId }: { channelId?: string | null; }) {
            if (channelId) joinedCalls.set(channelId, Date.now());
        },
        CONNECTION_OPEN() {
            // User settings arrive with the connection; apply once they are in
            setTimeout(applyPresence, 1000);
        }
    },

    toolboxActions: {
        "Toggle Silent Mode": toggleSilentMode
    },

    start() {
        running = true;
        wrapRequests();
        if (UserStore.getCurrentUser()) applyPresence();
    },

    stop() {
        running = false;
        unwrapRequests();
        joinedCalls.clear();
        // Bring back the status and activity sharing from before
        applyPresence();
    }
});
