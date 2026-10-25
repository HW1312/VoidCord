/*
 * SilentMode – title bar button, popout & settings
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { findComponentByCodeLazy } from "@webpack";
import { Popout, useRef, useState } from "@webpack/common";

import { classes, Icon, ICONS, Popover, Section, Sheet, ToggleRow, UiColor } from "../_ui";
import { settings } from "./index";

const cl = classNameFactory("vc-silentmode-");
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

// ---------------------------------------------------------------- Icons

const BELL_OFF_PATH = "M20 18.69 7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01c-.52.99-.8 2.16-.8 3.42v5l-2 2v1h13.73l2 2L21 19.72l-1-1.03ZM12 22c1.11 0 2-.89 2-2h-4c0 1.11.89 2 2 2Zm6-7.32V11c0-3.08-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68c-.15.03-.29.08-.42.12-.1.03-.2.07-.3.11h-.01c-.01 0-.01 0-.02.01-.23.09-.46.2-.68.31 0 0-.01 0-.01.01L18 14.68Z";
const KEYBOARD_PATH = "M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2Zm-9 3h2v2h-2V8Zm0 3h2v2h-2v-2ZM8 8h2v2H8V8Zm0 3h2v2H8v-2Zm-1 2H5v-2h2v2Zm0-3H5V8h2v2Zm9 7H8v-2h8v2Zm0-4h-2v-2h2v2Zm0-3h-2V8h2v2Zm3 3h-2v-2h2v2Zm0-3h-2V8h2v2Z";
const CHAT_PATH = "M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Z";
const REPLY_PATH = "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z";
const PHONE_PATH = "M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99Z";
const EYE_OFF_PATH = "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7ZM2 4.27l2.28 2.28.46.46A11.804 11.804 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27ZM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2Zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01Z";
const GAMEPAD_PATH = "M21.58 16.09l-1.09-7.66A3.996 3.996 0 0 0 16.53 5H7.47C5.48 5 3.79 6.46 3.51 8.43l-1.09 7.66C2.2 17.63 3.39 19 4.94 19c.68 0 1.32-.27 1.8-.75L9 16h6l2.25 2.25c.48.48 1.13.75 1.8.75 1.56 0 2.75-1.37 2.53-2.91ZM11 11H9v2H8v-2H6v-1h2V8h1v2h2v1Zm4-1c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1Zm2 3c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1Z";

const ICON_COLOR = "indigo";
const HEADER = { title: "Silent Mode", icon: BELL_OFF_PATH, iconColor: ICON_COLOR } as const;

// ---------------------------------------------------------------- Controls

type FeatureKey = "typing" | "messages" | "replyPing" | "deletes" | "calls" | "invisible" | "activity";

interface FeatureInfo { key: FeatureKey; icon: string; color: UiColor; title: string; subtitle: string; }

const CHAT: FeatureInfo[] = [
    { key: "typing", icon: KEYBOARD_PATH, color: "blue", title: "Silent typing", subtitle: "Nobody sees “… is typing”" },
    { key: "messages", icon: CHAT_PATH, color: "green", title: "Silent messages", subtitle: "Messages arrive normally, without push or sound" },
    { key: "replyPing", icon: REPLY_PATH, color: "teal", title: "No reply ping", subtitle: "Replies don't mention the person you reply to" },
    { key: "deletes", icon: ICONS.trash, color: "red", title: "Silent delete", subtitle: "Your message turns into gibberish right before it's deleted" }
];

const PRESENCE: FeatureInfo[] = [
    { key: "calls", icon: PHONE_PATH, color: "green", title: "Silent calls", subtitle: "Starting a DM or group call doesn't ring anyone" },
    { key: "invisible", icon: EYE_OFF_PATH, color: "gray", title: "Invisible", subtitle: "You appear offline, your old status comes back afterwards" },
    { key: "activity", icon: GAMEPAD_PATH, color: "purple", title: "Hide activity", subtitle: "Games and app activity aren't shown, turned back on afterwards" }
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
