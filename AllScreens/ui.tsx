/*
 * AllScreens – settings
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";

import { Glyph, Note, Row, Section, Segmented, Select, Sheet } from "../_ui";
import { lastSize, settings } from "./index";

const MONITORS_PATH = "M2 6a2 2 0 0 1 2-2h7a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H8v2h2a1 1 0 1 1 0 2H5a1 1 0 1 1 0-2h1v-2H4a2 2 0 0 1-2-2V6Zm11-1a1 1 0 0 1 1-1h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2v2h1a1 1 0 1 1 0 2h-5a1 1 0 1 1 0-2h2v-2h-2a1 1 0 0 1-1-1V5Z";
const GRID_PATH = "M3 4a1 1 0 0 1 1-1h7v8H3V4Zm10-1h7a1 1 0 0 1 1 1v7h-8V3ZM3 13h8v8H4a1 1 0 0 1-1-1v-7Zm10 0h8v7a1 1 0 0 1-1 1h-7v-8Z";
const SPEED_PATH = "M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44Zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83Z";
const WIDTH_PATH = "M7 11V8l-4 4 4 4v-3h10v3l4-4-4-4v3H7Z";
const HEADER = { title: "All Screens", icon: MONITORS_PATH, iconColor: "teal" } as const;

const FPS = [30, 60, 120, 144].map(v => ({ value: v, label: `${v} FPS` }));
const WIDTHS = [
    { value: 1920, label: "1920 px" },
    { value: 2560, label: "2560 px" },
    { value: 3840, label: "3840 px" }
];
const LAYOUTS = [
    { value: "grid", label: "Grid" },
    { value: "row", label: "Side by side" }
];

export const SettingsPanel = ErrorBoundary.wrap(() => {
    const { fps, maxWidth, layout } = settings.use(["fps", "maxWidth", "layout"]);

    return (
        <Sheet embedded header={HEADER}>
            <Note>
                Start a screen share as usual and pick “All screens” next to your single screens. All monitors are
                streamed in one picture, with your system sound.
            </Note>
            <Section
                title="Layout"
                footer="Grid (e.g. 2 + 1 for three monitors) is much sharper: Discord fits every stream into a 16:9 frame, so a long row of monitors gets shrunk to a thin strip."
            >
                <Row
                    leading={<Glyph path={GRID_PATH} color="teal" />}
                    title={<Segmented value={layout} options={LAYOUTS} onChange={v => settings.store.layout = v} />}
                />
            </Section>
            <Section
                title="Picture"
                footer={`Changes apply to the next stream. More than 3840 px isn't possible: graphics cards can't encode H264 that wide.${lastSize ? ` Last picture: ${lastSize}.` : ""}`}
            >
                <Row leading={<Glyph path={SPEED_PATH} color="orange" />} title="Frame rate" subtitle="Per monitor" trailing={<Select value={fps} options={FPS} onChange={v => settings.store.fps = v} />} />
                <Row leading={<Glyph path={WIDTH_PATH} color="indigo" />} title="Widest picture" subtitle="Larger setups are scaled down" trailing={<Select value={maxWidth} options={WIDTHS} onChange={v => settings.store.maxWidth = v} />} />
            </Section>
            <Note>
                For readable text, set the stream quality to <b>1440p</b> or <b>Source</b> when you start the stream, and give it
                more bitrate with the StreamUnlock plugin (e.g. 15–20 Mbit/s) – otherwise Discord squeezes the picture hard.
            </Note>
        </Sheet>
    );
}, { noop: true });
