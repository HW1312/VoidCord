/*
 * FakeMute – title bar button, popout & settings
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { findComponentByCodeLazy } from "@webpack";
import { MediaEngineStore, Popout, SelectedChannelStore, useRef, useState, useStateFromStores } from "@webpack/common";

import { classes, Icon, Note, Popover, Row, Section, Segmented, Sheet, State, strokeIcon, ToggleRow } from "../_ui";
import { Mode, setDeafMode, setMicMode, settings } from "./index";

const cl = classNameFactory("vc-fakemute-");
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

// ---------------------------------------------------------------- Icons

// Lucide mic / headphones
const MIC_PATH = strokeIcon("M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3");
const HEADPHONES_PATH = strokeIcon("M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3");

const ICON_COLOR = "orange";
const HEADER = { title: "Fake Mute", icon: HEADPHONES_PATH, iconColor: ICON_COLOR } as const;

// ---------------------------------------------------------------- State

function useVoiceState() {
    const { fakeMute, fakeDeafen } = settings.use(["fakeMute", "fakeDeafen"]);
    const realMute = useStateFromStores([MediaEngineStore], () => MediaEngineStore.isSelfMute());
    const realDeaf = useStateFromStores([MediaEngineStore], () => MediaEngineStore.isSelfDeaf());
    const inVoice = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getVoiceChannelId() != null);

    const micMode: Mode = realMute ? "real" : fakeMute ? "fake" : "off";
    const deafMode: Mode = realDeaf ? "real" : fakeDeafen ? "fake" : "off";

    return {
        micMode,
        deafMode,
        realMute,
        realDeaf,
        inVoice,
        shownMute: realMute || fakeMute || fakeDeafen,
        shownDeaf: realDeaf || fakeDeafen,
        fakeActive: fakeMute || fakeDeafen
    };
}

// ---------------------------------------------------------------- Building blocks

const MODES: { value: Mode; label: string; }[] = [
    { value: "off", label: "Off" },
    { value: "fake", label: "Fake" },
    { value: "real", label: "Real" }
];

function ModePicker({ value, disabled, onChange }: { value: Mode; disabled?: boolean; onChange(v: Mode): void; }) {
    return (
        <div className={classes(cl("modes"), disabled && cl("disabled"))}>
            <Segmented value={value} options={MODES} onChange={v => { if (!disabled) onChange(v); }} />
        </div>
    );
}

function StatusRow({ label, value, bad }: { label: string; value: string; bad: boolean; }) {
    return <Row title={label} trailing={<State tone={bad ? "bad" : "ok"}>{value}</State>} />;
}

const MIC_HINTS: Record<Mode, string> = {
    off: "Normal - your microphone works as usual.",
    fake: "Everyone sees you as muted, but can still hear you.",
    real: "You are actually muted - nobody can hear you."
};

const DEAF_HINTS: Record<Mode, string> = {
    off: "Normal - you hear everyone as usual.",
    fake: "Everyone sees you as deafened, but you can still hear everything.",
    real: "You are actually deafened (and therefore also muted)."
};

function Controls() {
    const s = useVoiceState();
    const { detectOthers } = settings.use(["detectOthers"]);

    return (
        <>
            <Section
                title="Microphone"
                footer={s.realDeaf ? "While you are actually deafened, your microphone is automatically off." : MIC_HINTS[s.micMode]}
            >
                <Row title={<ModePicker value={s.realDeaf ? "real" : s.micMode} disabled={s.realDeaf} onChange={setMicMode} />} />
                <StatusRow label="Others see" value={s.shownMute ? "Muted" : "Mic on"} bad={s.shownMute} />
                <StatusRow label="In reality" value={s.realMute ? "Nobody hears you" : "Everyone hears you"} bad={s.realMute} />
            </Section>
            {s.deafMode === "fake" && !s.realMute && (
                <Note tone="warn">
                    You appear deafened, but your mic is on - everyone can hear you. Set the microphone to “Real” if you don't want to be heard.
                </Note>
            )}

            <Section title="Headphones" footer={DEAF_HINTS[s.deafMode]}>
                <Row title={<ModePicker value={s.deafMode} onChange={setDeafMode} />} />
                <StatusRow label="Others see" value={s.shownDeaf ? "Deafened" : "Listening"} bad={s.shownDeaf} />
                <StatusRow label="In reality" value={s.realDeaf ? "You hear nobody" : "You hear everyone"} bad={s.realDeaf} />
            </Section>

            <Section
                title="Others"
                footer="Works for this plugin and any other fake mute plugin, but only in your own voice channel and only once they talk - someone who fake deafens and stays silent can't be detected."
            >
                <ToggleRow
                    icon={HEADPHONES_PATH}
                    color="blue"
                    title="Show fake mute/deafen in blue"
                    checked={detectOthers}
                    onChange={v => settings.store.detectOthers = v}
                />
            </Section>

            {!s.inVoice && s.fakeActive && (
                <Note>You are not in a voice channel - will be applied automatically when you join.</Note>
            )}
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
                    icon={MIC_PATH}
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
        <Popover width={320}>
            <Sheet header={HEADER}>
                <Controls />
            </Sheet>
        </Popover>
    );
}

function TitleBarButton() {
    const { showTitleBarButton, fakeMute, fakeDeafen } = settings.use(["showTitleBarButton", "fakeMute", "fakeDeafen"]);
    const fakeActive = fakeMute || fakeDeafen;
    const buttonRef = useRef(null);
    const [show, setShow] = useState(false);

    if (!showTitleBarButton) return null;

    const tooltip = fakeDeafen ? "Fake Deafen active" : fakeMute ? "Fake Mute active" : "Fake Mute";

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
                    className={classes(cl("btn"), fakeActive && cl("btn-active"))}
                    onClick={() => setShow(v => !v)}
                    tooltip={isShown ? null : tooltip}
                    icon={() => <Icon path={fakeDeafen ? HEADPHONES_PATH : MIC_PATH} size={20} className={classes("vc-ui-tb-icon", cl("icon"))} />}
                    selected={isShown}
                />
            )}
        </Popout>
    );
}

export function renderTitleBarButton() {
    return (
        <ErrorBoundary key="vc-fakemute-titlebar" noop>
            <TitleBarButton />
        </ErrorBoundary>
    );
}
