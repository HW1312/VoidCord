/*
 * VoiceLength – Vencord Userplugin
 * Voice messages you send show any length you want, e.g. a 3 second message that says 69:42. The length is written
 * into the audio file itself (Ogg Opus), so it stays for everyone – also after they hover or play it. After your
 * recording comes silence or the recording again until that length (as far as 10 MB go), or nothing at all.
 * Works with Discord's own recorder and Vencord's VoiceMessages plugin.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { RestAPI } from "@webpack/common";

import { FillMode, withLength } from "./ogg";
import { SettingsPanel } from "./ui";

const logger = new Logger("VoiceLength");

export const settings = definePluginSettings({
    panel: {
        type: OptionType.COMPONENT,
        component: () => <SettingsPanel />
    },
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Send voice messages with the fake length",
        default: true,
        hidden: true
    },
    seconds: {
        type: OptionType.NUMBER,
        description: "Length to show, in seconds",
        default: 69 * 60 + 42,
        hidden: true
    },
    fill: {
        type: OptionType.STRING,
        description: "What plays after your recording: display (nothing, only the shown length), silence or loop",
        default: "silence" as FillMode,
        hidden: true
    }
});

/** Discord's message flag for voice messages */
const IS_VOICE_MESSAGE = 1 << 13;

/** Voice message uploads: Discord's own recorder sets durationSecs, Vencord's VoiceMessages plugin names it like this */
const isVoiceUpload = (upload: any) => upload?.durationSecs != null || upload?.item?.file?.name === "voice-message.ogg";

/**
 * Called at the start of every attachment upload (Discord uploads as soon as a file is attached). Voice messages get
 * the new length written into the file.
 */
async function prepareUpload(upload: any) {
    if (!settings.store.enabled || !isVoiceUpload(upload)) return;
    const file = upload.item?.file;
    if (!(file instanceof File)) return;
    const { seconds, fill } = settings.store;
    try {
        const fake = await withLength(file, seconds, fill as FillMode);
        if (fake) {
            // Like Discord does after converting a file itself
            upload.item.file = fake.file;
            upload.currentSize = fake.file.size;
            if (fake.played < seconds - 1) logger.info(`Plays ${Math.round(fake.played)} s, the rest of ${seconds} s is only shown (upload limit)`);
        } else logger.warn(`${file.type || file.name} isn't Ogg Opus – only the shown length is changed, hovering shows the real one`);
        if (upload.durationSecs != null) upload.durationSecs = seconds;
    } catch (e) {
        logger.error("Could not change the length, sending the voice message as it is", e);
    }
}

/** The length shown before anyone plays it comes from the message itself – replace it in every voice message sent */
let originalPost: ((options: any, ...rest: any[]) => Promise<any>) | null = null;
let running = false;

/*
 * Pass on every argument: Discord's message queue hands its response callback as the 2nd one. Dropping it
 * leaves the queue waiting forever – the first message goes out, every later one stays grey until a reload.
 */
function wrappedPost(this: any, options: any, ...rest: any[]) {
    const body = options?.body;
    if (running && settings.store.enabled && body && (body.flags & IS_VOICE_MESSAGE) && Array.isArray(body.attachments)) {
        for (const a of body.attachments) if (a && "duration_secs" in a) a.duration_secs = settings.store.seconds;
    }
    return originalPost!.call(this, options, ...rest);
}

function wrapPost() {
    running = true;
    // Still installed from before: only acts while running
    if (originalPost) return;
    originalPost = RestAPI.post;
    RestAPI.post = wrappedPost;
}

function unwrapPost() {
    running = false;
    // Only restore when nobody (e.g. SilentMode) wrapped on top of us, else we would remove their wrapper too
    if (!originalPost || RestAPI.post !== wrappedPost) return;
    RestAPI.post = originalPost;
    originalPost = null;
}

export default definePlugin({
    name: "VoiceLength",
    description: "Voice messages you send show any length you want (e.g. 3 seconds that say 69:42) – for everyone",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Chat", "Fun"],
    settings,

    patches: [
        {
            // Start of every attachment upload (also hooked by OpSec – both insertions run)
            find: ".tryConvertToJpeg({file:",
            replacement: {
                match: /async upload\(\)\{/,
                replace: "$&await $self.prepareUpload(this);"
            }
        }
    ],

    prepareUpload,

    start() {
        wrapPost();
    },

    stop() {
        unwrapPost();
    }
});
