/*
 * StreamThumbnail – settings panel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { chooseFile } from "@utils/web";
import { findStoreLazy } from "@webpack";
import { showToast, useEffect, useRef, useState, useStateFromStores } from "@webpack/common";

import { Button, Empty, Field, Glyph, ICONS, Note, Row, Section, Sheet, strokeIcon, TextField, ToggleRow, useListener } from "../_ui";
import { getThumbnail, isStreaming, listeners, refresh, setPicture, settings, uploadNow } from "./index";

const cl = classNameFactory("vc-streamthumb-");
const ApplicationStreamingStore = findStoreLazy("ApplicationStreamingStore");

const PICTURE = ICONS.image;
// Lucide radio
const LIVE = strokeIcon("M4.9 19.1C1 15.2 1 8.8 4.9 4.9", "M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5", "M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5", "M19.1 4.9C23 8.8 23 15.1 19.1 19");
const HEADER = { title: "Stream Thumbnail", icon: PICTURE, iconColor: "pink" } as const;

const ThumbnailSheet = ErrorBoundary.wrap(() => {
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
        <Sheet embedded header={{ ...HEADER, subtitle: !thumbnail ? "No picture chosen" : enabled ? "Others see your picture as stream preview" : "Off – others see a screenshot", live: !!thumbnail && enabled && streaming }}>
            <Note>Your picture is sent a few seconds after you start streaming, and right away when you change it during a stream. Discord replaces the preview every 5 minutes - with your picture again, unless stream previews are turned off in Discord.</Note>

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

