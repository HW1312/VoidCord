/*
 * SecretChat – Voice messages in encrypted chats.
 * Discord's own recorder sends through MessageActions.sendMessage (flag IS_VOICE_MESSAGE, the recording in
 * attachmentsToUpload, uploaded only then); Vencord's VoiceMessages plugin starts a CloudUpload itself and posts
 * once it completes. Both are caught before anything is uploaded and go out as an encrypted file instead
 * (manifest vm = 1) – the plain recording with its real length: no waveform, no length from Discord, VoiceLength
 * leaves it alone.
 * Safety net: a voice message that still gets past (e.g. after a Discord update) is neither uploaded nor sent.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { ChannelStore, FluxDispatcher, RestAPI } from "@webpack/common";

import { notify } from "../_ui";
import { sendEncryptedFiles } from "./files";
import { channelKey, isLoaded } from "./store";

const logger = new Logger("SecretChat");

/** Discord's message flag for voice messages */
const IS_VOICE_MESSAGE = 1 << 13;
/** File name Vencord's VoiceMessages plugin uploads (Discord's recorder sets durationSecs instead) */
const VOICE_FILE = "voice-message.ogg";

/** For VoiceLength: voice messages in this chat are sent encrypted by us */
export const encryptsVoice = (channelId: string | null | undefined) =>
    !!channelId && !!Settings.plugins["Unter das OS"]?.enabled && !!channelKey(channelId);

/** Keys still loading: nobody knows yet whether the chat is encrypted – better not send */
const blocks = (channelId: string) => !isLoaded() || !!channelKey(channelId);

function notifyBlocked(reason: string) {
    notify({ title: "Voice message not sent", body: reason, kind: "error", app: "Unter das OS" });
}

function sendVoice(channelId: string, file: File, reference?: unknown) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return notifyBlocked("The chat could not be found.");
    notify({ title: "Sending voice message encrypted …", kind: "info", app: "Unter das OS" });
    void sendEncryptedFiles(channel, [file], reference, { voice: true });
}

/**
 * MessageActions.sendMessage wrapper (Discord's recorder). true = handled, Discord sends nothing.
 * options = the 4th argument of sendMessage.
 */
export function takeVoiceSend(channelId: string, options: any): boolean {
    if (!options || !(options.flags & IS_VOICE_MESSAGE)) return false;
    try {
        if (!isLoaded()) {
            notifyBlocked("Unter das OS is still loading its keys – try again in a second.");
            return true;
        }
        if (!channelKey(channelId)) return false;

        const uploads: any[] = Array.isArray(options.attachmentsToUpload) ? options.attachmentsToUpload : [];
        const file = uploads[0]?.item?.file;
        if (!(file instanceof File)) {
            notifyBlocked("The recording could not be read, so it could not be encrypted.");
            return true;
        }
        sendVoice(channelId, file, options.messageReference);
        if (options.messageReference) FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });
        // Discord deletes its temporary recording file once the upload reports back – the File stays in memory
        for (const u of uploads) u?.emit?.("complete");
        return true;
    } catch (e) {
        logger.error("Encrypting a voice message failed", e);
        notifyBlocked("Encrypting it failed.");
        return true;
    }
}

/**
 * Start of every CloudUpload (patched into upload()). true = don't upload.
 * Throws for a voice message that should have been caught in sendMessage, so Discord marks it as failed.
 */
export function takeVoiceUpload(upload: any): boolean {
    const file = upload?.item?.file;
    const recorder = upload?.durationSecs != null;
    if (!recorder && file?.name !== VOICE_FILE) return false;
    const channelId: string | undefined = upload?.channelId;
    if (!channelId || !blocks(channelId)) return false;

    if (!isLoaded()) {
        notifyBlocked("Unter das OS is still loading its keys – try again in a second.");
    } else if (!recorder && file instanceof File) {
        // VoiceMessages posts only after "complete", which now never comes
        sendVoice(channelId, file);
        return true;
    } else {
        logger.error("A voice message got past the sendMessage wrapper – blocked");
        notifyBlocked("It would have gone out unencrypted.");
    }
    if (recorder) throw new Error("Unter das OS: unencrypted voice message blocked");
    return true;
}

// ---------------------------------------------------------------- Last safety net: the message itself

const MESSAGES_URL = /\/channels\/(\d+)\/messages(?:$|\?)/;

let originalPost: ((options: any, ...rest: any[]) => Promise<any>) | null = null;
let running = false;

// Pass on every argument – Discord's message queue hands its response callback as the 2nd one
function guardedPost(this: any, options: any, ...rest: any[]) {
    const body = options?.body;
    if (running && body && (body.flags & IS_VOICE_MESSAGE)) {
        const channelId = body.channel_id ?? String(options.url ?? "").match(MESSAGES_URL)?.[1];
        if (channelId && blocks(channelId)) {
            logger.error("Unencrypted voice message stopped before sending");
            notifyBlocked("It would have gone out unencrypted.");
            return Promise.reject(new Error("Unter das OS: unencrypted voice message blocked"));
        }
    }
    return originalPost!.call(this, options, ...rest);
}

export function guardVoicePosts() {
    running = true;
    // Still installed from before: only acts while running
    if (originalPost) return;
    originalPost = RestAPI.post;
    RestAPI.post = guardedPost;
}

export function unguardVoicePosts() {
    running = false;
    // Only restore when nobody (VoiceLength, SilentMode) wrapped on top of us, else their wrapper would go too
    if (!originalPost || RestAPI.post !== guardedPost) return;
    RestAPI.post = originalPost;
    originalPost = null;
}
