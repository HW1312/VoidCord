/*
 * SecretChat – saving decrypted files.
 * Desktop saves use a native dialog so cancellation and write failures are reported.
 * Browsers use their regular download handling.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { PluginNative } from "@utils/types";

const logger = new Logger("SecretChat");
const Native = VencordNative.pluginHelpers["Unter das OS"] as PluginNative<typeof import("./native")>;
const saving = new Set<string>();

/** Also used for explicit downloads; automatic media previews stay in the message. */
export function createFileProgress(name: string) {
    let stack = document.querySelector<HTMLElement>(".vc-secretchat-download-stack");
    if (!stack) {
        stack = document.createElement("div");
        stack.className = "vc-secretchat-download-stack";
        document.body.appendChild(stack);
    }
    const card = document.createElement("div");
    card.className = "vc-secretchat-download-card";
    card.setAttribute("role", "status");
    const title = document.createElement("div");
    title.className = "vc-secretchat-download-name";
    title.textContent = name;
    const status = document.createElement("div");
    status.className = "vc-secretchat-download-status";
    const progress = document.createElement("progress");
    progress.max = 1;
    progress.setAttribute("aria-label", `File operation: ${name}`);
    card.append(title, status, progress);
    stack.appendChild(card);
    return {
        update(text: string) { status.textContent = text; },
        finish(state: "done" | "error" | "cancelled", text: string) {
            card.dataset.state = state;
            status.textContent = text;
            if (state === "done") progress.value = 1;
            else progress.remove();
            setTimeout(() => {
                card.remove();
                if (!stack.childElementCount) stack.remove();
            }, state === "error" ? 8000 : 4000);
        }
    };
}

export async function saveDecrypted(url: string, name: string) {
    if (saving.has(url)) return;
    saving.add(url);
    const card = createFileProgress(name);
    card.update("Preparing to save…");
    try {
        if (IS_DISCORD_DESKTOP) {
            if (!Native?.save) throw new Error("Restart Discord completely to load the file saver");
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Couldn't read the decrypted file (${response.status})`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            card.update("Choose a save location in the dialog…");
            const saved = await Native.save(bytes, name);
            card.finish(saved ? "done" : "cancelled", saved ? "File saved" : "Save cancelled");
            return;
        }
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        card.finish("done", "Download handed to your browser");
    } catch (e) {
        logger.error("Couldn't save file", e);
        card.finish("error", `Couldn't save: ${String((e as Error)?.message ?? e)}`);
    } finally {
        saving.delete(url);
    }
}
