/*
 * VoiceLength – settings panel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { useState } from "@webpack/common";

import { Field, Note, Pill, Pills, Section, Segmented, Sheet, TextField, ToggleRow } from "../_ui";
import { FillMode } from "./ogg";
import { settings } from "./index";

const CLOCK = "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.41V7h-2v6l4.6 2.76 1-1.64L13 12.41Z";
const HEADER = { title: "Voice Length", icon: CLOCK, iconColor: "orange" } as const;

/** Discord shows lengths as minutes:seconds only (1 hour = "60:00") – up to 9999:59 */
const MAX = 9999 * 60 + 59;

const PRESETS = [1, 4 * 60 + 20, 69 * 60 + 42, 420 * 60, 1337 * 60, MAX];

const FILL_HINT: Record<FillMode, string> = {
    display: "Only the shown length is fake – the sound ends after your recording, then the player jumps to the end.",
    silence: "Silence until the shown length, so it really plays that long. Fits about 100 hours into Discord's 10 MB limit – beyond that the rest is only shown.",
    loop: "Your recording again and again until the shown length. Takes much more room: roughly 15–40 minutes fit into 10 MB, the rest is only shown."
};

/** Like Discord's player: m:ss */
export const format = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** "69:42" or plain seconds → seconds, or null */
function parse(text: string) {
    const parts = text.trim().split(":");
    if (parts.length > 2 || parts.some(p => !/^\d+$/.test(p))) return null;
    const seconds = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
    return seconds >= 1 && seconds <= MAX ? seconds : null;
}

export const SettingsPanel = ErrorBoundary.wrap(() => {
    const { enabled, seconds, fill } = settings.use(["enabled", "seconds", "fill"]);
    const [text, setText] = useState(() => format(seconds));
    const parsed = parse(text);

    const pick = (s: number) => {
        settings.store.seconds = s;
        setText(format(s));
    };

    return (
        <Sheet embedded header={{ ...HEADER, subtitle: enabled ? `Voice messages show ${format(seconds)}` : "Off – voice messages show their real length" }}>
            <Note>Send a voice message as usual – it's sent with this length, and everyone sees it, also after playing it.</Note>

            <Section>
                <ToggleRow
                    icon={CLOCK}
                    color="orange"
                    title="Fake length"
                    subtitle="For every voice message you send"
                    checked={enabled}
                    onChange={v => settings.store.enabled = v}
                />
            </Section>

            <Section>
                <Field label="Shown length" hint={parsed == null ? "Use minutes:seconds, from 0:01 up to 9999:59" : `Shown as ${format(parsed)}`}>
                    <TextField
                        value={text}
                        placeholder="69:42"
                        onChange={v => {
                            setText(v);
                            const s = parse(v);
                            if (s != null) settings.store.seconds = s;
                        }}
                    />
                    <Pills>
                        {PRESETS.map(p => (
                            <Pill key={p} selected={seconds === p} onClick={() => pick(p)}>{format(p)}</Pill>
                        ))}
                    </Pills>
                </Field>
            </Section>

            <Section>
                <Field label="After your recording" hint={FILL_HINT[fill as FillMode]}>
                    <Segmented<FillMode>
                        value={fill as FillMode}
                        options={[
                            { value: "display", label: "Nothing" },
                            { value: "silence", label: "Silence" },
                            { value: "loop", label: "Loop" }
                        ]}
                        onChange={v => settings.store.fill = v}
                    />
                </Field>
            </Section>
        </Sheet>
    );
}, { noop: true });
