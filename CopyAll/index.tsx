/*
 * CopyAll – Vencord Userplugin
 * Copy buttons for everything in the chat. Click → it's on the clipboard, and the button plays the kit's copy
 * animation (no toast).
 *   - message text → button right at the end of the text (shown while the message is hovered): the original
 *     text with its markdown (**bold**, `code` …), so pasted into Discord it looks the same again
 *   - pictures / stickers → floating button in their corner: the picture itself (any format → PNG, main process)
 *   - GIFs / videos → their link (the clipboard can't hold animations; pasted into Discord it shows the GIF)
 *   - code blocks → floating button in their corner: the code
 *
 * The floating button: one element on <body> (own React root, pointer-events only on the button) that follows
 * the mouse. What's under the mouse is found with elementsFromPoint, so Discord's hover overlays on pictures
 * don't get in the way, and nothing is injected into Discord's own React trees.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { copyToClipboard } from "@utils/clipboard";
import { Logger } from "@utils/Logger";
import definePlugin, { PluginNative } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { createRoot, MessageStore, React, Tooltip, useEffect, useReducer, useRef, useState } from "@webpack/common";

import { Icon, IconButton, ICONS, notify } from "../_ui";

const Native = VencordNative.pluginHelpers.CopyAll as PluginNative<typeof import("./native")> | undefined;
const logger = new Logger("CopyAll");
const cl = classNameFactory("vc-copyall-");

const BUTTON = 28;
/** Pictures smaller than this are emojis, avatars, icons … – no button */
const MIN_MEDIA = 48;

type Kind = "code" | "image" | "gif" | "video";

interface Target {
    kind: Kind;
    el: Element;
    /** fixed position of the button */
    x: number;
    y: number;
    copy(): Promise<void>;
}

const LABELS: Record<Kind, string> = {
    code: "Copy code",
    image: "Copy image",
    gif: "Copy GIF link",
    video: "Copy video link"
};

// ---------------------------------------------------------------- Finding what's under the mouse

/** chat-messages-<channelId>-<messageId> → the message (null outside the chat, e.g. pins / search use the same ids) */
function messageOf(el: Element) {
    const item = el.closest<HTMLElement>('[id^="chat-messages-"]');
    const m = item?.id.match(/^chat-messages-(\d+)-(\d+)$/);
    return m ? MessageStore.getMessage(m[1], m[2]) ?? null : null;
}

const inMessage = (el: Element) => !!el.closest('[id^="chat-messages-"]');

/** Discord's media proxy URL → the original file (size / format params removed, signature kept) */
function originalUrl(src: string, asLink: boolean) {
    try {
        const u = new URL(src, location.href);
        if (u.protocol === "blob:" || u.protocol === "data:") return src;
        for (const p of ["width", "height", "quality", "format", "size"]) u.searchParams.delete(p);
        // Attachments: the CDN link is what you'd share (media.discordapp.net is the resizing proxy)
        if (asLink && u.hostname === "media.discordapp.net" && u.pathname.startsWith("/attachments/")) u.hostname = "cdn.discordapp.com";
        return u.toString();
    } catch {
        return src;
    }
}

const isAnimatedSrc = (src: string) => /\.gif($|\?)/i.test(src) || /[?&]animated=true/.test(src);

/** A GIF embed (Tenor / Giphy) plays as a <video>: share its page link, that's what shows the GIF again */
function embedLinkOf(video: HTMLVideoElement) {
    const msg: any = messageOf(video);
    const src = (video.currentSrc || video.src).split("?")[0];
    if (!msg || !src) return null;
    for (const e of msg.embeds ?? []) {
        const urls = [e.video?.url, e.video?.proxyURL, e.video?.proxy_url, e.thumbnail?.url, e.thumbnail?.proxyURL, e.thumbnail?.proxy_url];
        if (e.url && urls.some((u: string | undefined) => u && u.split("?")[0] === src)) return e.url as string;
    }
    return null;
}

/** Button in the top right corner, inside */
function topRight(el: Element) {
    const r = el.getBoundingClientRect();
    return { x: r.right - BUTTON - 6, y: r.top + 6 };
}

function mediaTarget(stack: Element[]): Target | null {
    const media = stack.find((e): e is HTMLImageElement | HTMLVideoElement => (e instanceof HTMLImageElement || e instanceof HTMLVideoElement));
    if (!media || !inMessage(media)) return null;
    const r = media.getBoundingClientRect();
    if (r.width < MIN_MEDIA || r.height < MIN_MEDIA) return null;
    const cls = typeof media.className === "string" ? media.className : "";
    if (/avatar|emoji|roleIcon|decoration/i.test(cls) || media.closest('[class*="avatar"], [class*="reaction"]')) return null;

    if (media instanceof HTMLVideoElement) {
        const src = media.currentSrc || media.src;
        if (!src) return null;
        // GIF embeds loop without controls; real videos have Discord's player around them
        const link = embedLinkOf(media);
        const kind: Kind = link || media.loop ? "gif" : "video";
        return { kind, el: media, ...topRight(media), copy: () => copyToClipboard(link ?? originalUrl(src, true)) };
    }

    const src = media.currentSrc || media.src;
    if (!src) return null;
    if (isAnimatedSrc(src)) {
        return { kind: "gif", el: media, ...topRight(media), copy: () => copyToClipboard(originalUrl(src, true)) };
    }
    return { kind: "image", el: media, ...topRight(media), copy: () => copyImage(originalUrl(src, false)) };
}

/** Code blocks get the floating button in their corner (the message text itself: hover toolbar, see below) */
function codeTarget(stack: Element[]): Target | null {
    const block = stack[0]?.closest("pre");
    if (!block || !block.closest('[id^="message-content-"]') || !inMessage(block)) return null;
    const code = block.querySelector("code") ?? block;
    return { kind: "code", el: block, ...topRight(block), copy: () => copyToClipboard(code.textContent ?? "") };
}

// ---------------------------------------------------------------- Message text: button at the end of the text

/**
 * Sits right after the message text (patched into Discord's message content, before "(edited)"), shown while the
 * message is hovered. Copies the original text with its markdown (**bold**, `code` …) – pasted into Discord it
 * looks the same again. Feedback: the kit's copy → green check animation (same CSS classes as the kit's buttons).
 */
function TextCopyButton({ message }: { message: Message; }) {
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    const text = message.content;
    if (!text?.trim()) return null;

    const copy = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        copyToClipboard(text).catch(err => {
            logger.error("Copying failed", err);
            notify({ title: "Couldn't copy", body: reason(err), kind: "error", app: "CopyAll" });
        });
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
    };

    return (
        <Tooltip text={copied ? "Copied" : "Copy text"}>
            {(tip: any) => (
                <button
                    {...tip}
                    type="button"
                    aria-label="Copy text"
                    className={`${cl("inline")} vc-ui-ia-copy ${copied ? `vc-ui-ia-copied ${cl("inline-copied")}` : ""}`}
                    onClick={copy}
                >
                    <Icon key={copied ? "check" : "copy"} path={copied ? ICONS.check : ICONS.copy} size={16} />
                </button>
            )}
        </Tooltip>
    );
}

// ---------------------------------------------------------------- Copying a picture

async function toPng(blob: Blob): Promise<Uint8Array> {
    const bmp = await createImageBitmap(blob);
    try {
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        canvas.getContext("2d")!.drawImage(bmp, 0, 0);
        return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    } finally {
        bmp.close();
    }
}

/** "Error invoking remote method 'VencordPluginNative_…': Error: reason" → "reason" */
const reason = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

async function loadBytes(url: string) {
    const local = url.startsWith("blob:") || url.startsWith("data:");
    if (!local && Native) {
        try {
            return await Native.fetchImage(url);
        } catch (e) {
            // Main process part missing (Discord only reloaded, not restarted) or failed – try the page itself
            logger.warn("Loading through the main process failed, trying directly", e);
        }
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't load the picture (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
}

async function copyImage(url: string) {
    const png = await toPng(new Blob([await loadBytes(url) as BlobPart]));
    let nativeError: unknown;
    if (Native) {
        try {
            await Native.writeImage(png);
            return;
        } catch (e) {
            nativeError = e;
            logger.warn("Writing through the main process failed, trying the page clipboard", e);
        }
    }
    try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([png as BlobPart], { type: "image/png" }) })]);
    } catch (e) {
        throw new Error(nativeError ? reason(nativeError) : reason(e));
    }
}

// ---------------------------------------------------------------- Following the mouse

let current: Target | null = null;
/** changes with every new target, so the button (and its copy animation) starts fresh */
let generation = 0;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let frame = 0;
let lastX = 0, lastY = 0;

function setTarget(t: Target | null) {
    if (t) {
        clearTimeout(hideTimer);
        hideTimer = undefined;
        if (t.el !== current?.el) generation++;
        current = t;
        emit();
    } else if (current && !hideTimer) {
        // A short grace period: the mouse is on its way to the button
        hideTimer = setTimeout(() => { hideTimer = undefined; current = null; emit(); }, 250);
    }
}

function update() {
    frame = 0;
    const stack = document.elementsFromPoint(lastX, lastY);
    if (stack[0] && host?.contains(stack[0])) {
        clearTimeout(hideTimer);
        hideTimer = undefined;
        return;
    }
    setTarget(mediaTarget(stack) ?? codeTarget(stack));
}

function onMouseMove(e: MouseEvent) {
    if (e.buttons) return; // selecting text or dragging
    lastX = e.clientX;
    lastY = e.clientY;
    if (!frame) frame = requestAnimationFrame(update);
}

function onScroll() {
    if (!current) return;
    current = null;
    emit();
}

function CopyLayer() {
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    useEffect(() => {
        listeners.add(rerender);
        return () => void listeners.delete(rerender);
    }, []);
    const t = current;
    if (!t) return null;
    const x = Math.max(4, Math.min(window.innerWidth - BUTTON - 4, t.x));
    const y = Math.max(4, Math.min(window.innerHeight - BUTTON - 4, t.y));
    return (
        <div key={generation} className={`${cl("button")} ${cl("on-media")}`} style={{ left: x, top: y }}>
            <IconButton
                icon={ICONS.copy}
                label={LABELS[t.kind]}
                onClick={() => {
                    t.copy().catch(e => {
                        logger.error("Copying failed", e);
                        notify({ title: "Couldn't copy", body: reason(e), kind: "error", app: "CopyAll" });
                    });
                }}
            />
        </div>
    );
}

// ---------------------------------------------------------------- Plugin

export default definePlugin({
    name: "CopyAll",
    description: "Copy buttons for everything in the chat: message text (with its formatting), code blocks, pictures, stickers, GIFs and videos",
    about: "Copy anything in a chat with one click: the message text with its formatting from the button at the end of the text, and pictures, GIFs, videos and code blocks with the button in their corner. Pictures are copied as the picture itself, GIFs and videos as their link.",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Chat", "Utility"],
    patches: [
        {
            // Message content: the copy button right after the text (before "(edited)"). SecretChat (lock in front),
            // MessageLogger and RoleColorEverywhere patch the same spot – the gaps allow their additions.
            find: ".SEND_FAILED,",
            replacement: {
                match: /(?<=\]:(\i)\.isUnsupported.{0,200}?children:\[.{0,300}?)(\i\?\?\i\(\i,\i\))(?=,)/,
                replace: "$2,$self.renderTextCopy($1)"
            }
        }
    ],

    renderTextCopy: (message: Message | null) => message?.content
        ? <ErrorBoundary key="vc-copyall-text" noop><TextCopyButton message={message} /></ErrorBoundary>
        : null,

    start() {
        host = document.createElement("div");
        host.id = "vc-copyall-layer";
        document.body.appendChild(host);
        root = createRoot(host);
        root.render(<CopyLayer />);
        document.addEventListener("mousemove", onMouseMove, { passive: true });
        document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    },

    stop() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("scroll", onScroll, { capture: true });
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        clearTimeout(hideTimer);
        hideTimer = undefined;
        current = null;
        root?.unmount();
        root = null;
        host?.remove();
        host = null;
    }
});
