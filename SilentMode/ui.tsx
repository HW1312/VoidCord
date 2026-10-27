/*
 * SilentMode – title bar button, popout & settings
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { findComponentByCodeLazy } from "@webpack";
import { Popout, useRef, useState } from "@webpack/common";

import { classes, Icon, ICONS, Popover, Section, Sheet, strokeIcon, ToggleRow, UiColor } from "../_ui";
import { settings } from "./index";

const cl = classNameFactory("vc-silentmode-");
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

// ---------------------------------------------------------------- Icons

// Lucide bell-off / keyboard / message-square / reply / phone / eye-off / gamepad-2
const BELL_OFF_PATH = strokeIcon("M10.268 21a2 2 0 0 0 3.464 0", "M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742", "m2 2 20 20", "M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05");
const KEYBOARD_PATH = strokeIcon("M10 8h.01", "M12 12h.01", "M14 8h.01", "M16 12h.01", "M18 8h.01", "M6 8h.01", "M7 16h10", "M8 12h.01", "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z");
const CHAT_PATH = strokeIcon("M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z");
const REPLY_PATH = strokeIcon("m9 17-5-5 5-5", "M20 18v-2a4 4 0 0 0-4-4H4");
const PHONE_PATH = strokeIcon("M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384");
const EYE_OFF_PATH = strokeIcon("M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49", "M14.084 14.158a3 3 0 0 1-4.242-4.242", "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143", "m2 2 20 20");
const GAMEPAD_PATH = strokeIcon("M6 11h4", "M8 9v4", "M15 12h.01", "M18 10h.01", "M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z");

const ICON_COLOR = "indigo";
const HEADER = { title: "Silent Mode", icon: BELL_OFF_PATH, iconColor: ICON_COLOR } as const;

// ---------------------------------------------------------------- Controls

type FeatureKey = "typing" | "messages" | "replyPing" | "deletes" | "calls" | "invisible" | "activity";

interface FeatureInfo { key: FeatureKey; icon: string; color: UiColor; title: string; subtitle: string; }

const CHAT: FeatureInfo[] = [
    { key: "typing", icon: KEYBOARD_PATH, color: "gray", title: "Silent typing", subtitle: "Nobody sees “… is typing”" },
    { key: "messages", icon: CHAT_PATH, color: "gray", title: "Silent messages", subtitle: "Messages arrive normally, without push or sound" },
    { key: "replyPing", icon: REPLY_PATH, color: "gray", title: "No reply ping", subtitle: "Replies don't mention the person you reply to" },
    { key: "deletes", icon: ICONS.trash, color: "red", title: "Silent delete", subtitle: "Your message turns into gibberish right before it's deleted" }
];

const PRESENCE: FeatureInfo[] = [
    { key: "calls", icon: PHONE_PATH, color: "gray", title: "Silent calls", subtitle: "Starting a DM or group call doesn't ring anyone" },
    { key: "invisible", icon: EYE_OFF_PATH, color: "gray", title: "Invisible", subtitle: "You appear offline, your old status comes back afterwards" },
    { key: "activity", icon: GAMEPAD_PATH, color: "gray", title: "Hide activity", subtitle: "Games and app activity aren't shown, turned back on afterwards" }
];

function FeatureRows({ list }: { list: FeatureInfo[]; }) {
    const values = settings.use(list.map(f => f.key));
    return (
        <>
            {list.map(f => (
                <ToggleRow
                    key={f.key}
                    icon={f.icon}
                    color={f.color}
                    title={f.title}
                    subtitle={f.subtitle}
                    checked={values[f.key]}
                    onChange={v => settings.store[f.key] = v}
                />
            ))}
        </>
    );
}

function Controls() {
    const { enabled } = settings.use(["enabled"]);

    return (
        <>
            <Section footer={enabled ? "Everything turned on below is active." : "Choose below what Silent Mode does, then turn it on."}>
                <ToggleRow
                    icon={BELL_OFF_PATH}
                    color={ICON_COLOR}
                    title="Silent Mode"
                    subtitle={enabled ? "On" : "Off"}
                    checked={enabled}
                    onChange={v => settings.store.enabled = v}
                />
            </Section>

            <Section
                title="Chat"
                footer="Message loggers that also keep edits (like Vencord's MessageLogger by default) still show the original text in the edit history. Silent delete only fools loggers that keep the last version."
            >
                <FeatureRows list={CHAT} />
            </Section>

            <Section
                title="Calls & status"
                footer="Others still hear the join sound when you join a voice channel – their own Discord plays it, nothing on your side can stop that."
            >
                <FeatureRows list={PRESENCE} />
            </Section>
        </>
    );
}

// ---------------------------------------------------------------- Settings

export const SettingsPanel = ErrorBoundary.wrap(() => {
    const { showTitleBarButton } = settings.use(["showTitleBarButton"]);

    return (
        <Sheet embedded header={HEADER}>
            <Controls />
            <Section>
                <ToggleRow
                    icon={BELL_OFF_PATH}
                    color={ICON_COLOR}
                    title="Show icon in the title bar"
                    checked={showTitleBarButton}
                    onChange={v => settings.store.showTitleBarButton = v}
                />
            </Section>
        </Sheet>
    );
}, { noop: true });

// ---------------------------------------------------------------- Title bar

function PopoutPanel() {
    return (
        <Popover width={340}>
            <Sheet header={HEADER}>
                <Controls />
            </Sheet>
        </Popover>
    );
}

function TitleBarButton() {
    const { showTitleBarButton, enabled } = settings.use(["showTitleBarButton", "enabled"]);
    const buttonRef = useRef(null);
    const [show, setShow] = useState(false);

    if (!showTitleBarButton) return null;

    return (
        <Popout
            position="bottom"
            align="left"
            animation={Popout.Animation.NONE}
            shouldShow={show}
            onRequestClose={() => setShow(false)}
            targetElementRef={buttonRef}
            renderPopout={() => (
                <ErrorBoundary noop>
                    <PopoutPanel />
                </ErrorBoundary>
            )}
        >
            {(_, { isShown }) => (
                <HeaderBarIcon
                    ref={buttonRef}
                    className={classes(cl("btn"), enabled && cl("btn-active"))}
                    onClick={() => setShow(v => !v)}
                    tooltip={isShown ? null : enabled ? "Silent Mode on" : "Silent Mode"}
                    icon={() => <Icon path={enabled ? BELL_OFF_PATH : ICONS.bell} size={20} className={classes("vc-ui-tb-icon", cl("icon"))} />}
                    selected={isShown}
                />
            )}
        </Popout>
    );
}

export function renderTitleBarButton() {
    return (
        <ErrorBoundary key="vc-silentmode-titlebar" noop>
            <TitleBarButton />
        </ErrorBoundary>
    );
}
