/*
 * StreamThumbnail – settings panel, window and right-click menu of the "Share Your Screen" button
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { chooseFile } from "@utils/web";
import { findStoreLazy } from "@webpack";
import { ContextMenuApi, Menu, showToast, useEffect, useRef, useState, useStateFromStores } from "@webpack/common";

import { Button, Empty, Field, Glyph, ICONS, Note, openWindow, Row, Section, Sheet, strokeIcon, TextField, ToggleRow, useListener } from "../_ui";
import { getThumbnail, isStreaming, listeners, refresh, setPicture, settings, uploadNow } from "./index";

const cl = classNameFactory("vc-streamthumb-");
const ApplicationStreamingStore = findStoreLazy("ApplicationStreamingStore");

const PICTURE = ICONS.image;
// Lucide radio
const LIVE = strokeIcon("M4.9 19.1C1 15.2 1 8.8 4.9 4.9", "M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5", "M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5", "M19.1 4.9C23 8.8 23 15.1 19.1 19");
const HEADER = { title: "Stream Thumbnail", icon: PICTURE, iconColor: "pink" } as const;

/** With onClose it's a window, without it sits in the plugin's settings */
const ThumbnailSheet = ErrorBoundary.wrap(({ onClose }: { onClose?(): void; }) => {
    useListener(listeners);
    const { enabled, caption } = settings.use(["enabled", "caption"]);
    const streaming = useStateFromStores([ApplicationStreamingStore], () => isStreaming());
    const [text, setText] = useState(caption);
    const [busy, setBusy] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const thumbnail = getThumbnail();

    // Re-render shortly after typing stops (and send it while you stream)
    useEffect(() => () => clearTimeout(timer.current), []);
    const onCaption = (v: string) => {
        setText(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            settings.store.caption = v;
            refresh();
        }, 600);
    };

    const run = async (task: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await task();
        } catch (e) {
            showToast({ text: String((e as Error)?.message ?? e), variant: "critical" });
        } finally {
            setBusy(false);
        }
    };

    const pick = () => run(async () => {
        const file = await chooseFile("image/*");
        if (file) await setPicture(file);
    });

    return (
        <Sheet embedded={!onClose} onClose={onClose} header={{ ...HEADER, subtitle: !thumbnail ? "No picture chosen" : enabled ? "Others see your picture as stream preview" : "Off – others see a screenshot", live: !!thumbnail && enabled && streaming }}>
            <Note>Discord sends a new stream preview every 5 minutes (the first after 1 minute). While you stream, a new picture or caption is sent right away. It doesn't work if stream previews are turned off in Discord.</Note>

            <Section title="Preview">
                <div className={cl("box")}>
                    {thumbnail
                        ? <img className={cl("preview")} src={thumbnail} alt="" draggable={false} />
                        : <Empty icon={PICTURE} title="No picture yet" hint="Choose a picture – it's cropped to 16:9 like Discord's preview." />}
                    <div className={cl("actions")}>
                        <Button small onClick={pick} disabled={busy}>{thumbnail ? "Change picture" : "Choose picture"}</Button>
                        {thumbnail && <Button small variant="gray" disabled={busy} onClick={() => run(() => setPicture(null))}>Remove</Button>}
                    </div>
                </div>
            </Section>

            <Section>
                <Field label="Caption" hint="Big white text at the bottom, like a YouTube thumbnail. Leave empty for none.">
                    <TextField value={text} placeholder="RANKED GRIND 🔴" maxLength={60} onChange={onCaption} />
                </Field>
            </Section>

            <Section footer={streaming ? undefined : "Start a Go Live stream to send the picture right away."}>
                <ToggleRow
                    icon={PICTURE}
                    color="gray"
                    title="Use my picture"
                    subtitle="Instead of a screenshot of your stream"
                    checked={enabled}
                    onChange={v => {
                        settings.store.enabled = v;
                        if (v) refresh();
                    }}
                />
                <Row
                    leading={<Glyph path={LIVE} color={streaming ? "red" : "gray"} />}
                    title="Your stream"
                    subtitle={streaming ? "Live – send the picture without waiting" : "Not streaming"}
                    trailing={
                        <Button
                            small
                            variant="tinted"
                            disabled={!streaming || !thumbnail || !enabled || busy}
                            onClick={() => run(async () => {
                                if (await uploadNow()) showToast({ text: "Thumbnail sent", variant: "success" });
                            })}
                        >
                            Send now
                        </Button>
                    }
                />
            </Section>
        </Sheet>
    );
}, { noop: true });

export const SettingsPanel = () => <ThumbnailSheet />;

export const openThumbnailWindow = () => openWindow(close => <ThumbnailSheet onClose={close} />, { size: "small" });

async function pickPicture() {
    try {
        const file = await chooseFile("image/*");
        if (file) await setPicture(file);
    } catch (e) {
        showToast({ text: String((e as Error)?.message ?? e), variant: "critical" });
    }
}

/** Right-click on the "Share Your Screen" button in the voice panel */
export function openShareMenu(e: React.MouseEvent) {
    ContextMenuApi.openContextMenu(e, () => {
        const streaming = isStreaming();
        const thumbnail = getThumbnail();
        // Discord's menu only accepts menu items and groups as children – no fragments, or it crashes
        return (
            <Menu.Menu navId="vc-streamthumb" onClose={ContextMenuApi.closeContextMenu} aria-label="Stream Thumbnail">
                <Menu.MenuItem id="vc-streamthumb-pick" label={thumbnail ? "Change stream picture…" : "Choose stream picture…"} action={pickPicture} />
                <Menu.MenuItem id="vc-streamthumb-open" label="Stream picture & caption…" action={openThumbnailWindow} />
                <Menu.MenuSeparator />
                <Menu.MenuCheckboxItem
                    id="vc-streamthumb-enabled"
                    label="Use my picture as preview"
                    checked={settings.store.enabled}
                    disabled={!thumbnail}
                    action={() => {
                        settings.store.enabled = !settings.store.enabled;
                        if (settings.store.enabled) refresh();
                    }}
                />
                {streaming && thumbnail && settings.store.enabled
                    ? <Menu.MenuItem id="vc-streamthumb-send" label="Send preview now" action={() => uploadNow().then(ok => ok && showToast({ text: "Thumbnail sent", variant: "success" }), err => showToast({ text: String(err?.message ?? err), variant: "critical" }))} />
                    : null}
            </Menu.Menu>
        );
    });
}
