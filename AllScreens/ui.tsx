/*
 * AllScreens – settings
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";

import { Glyph, Note, Row, Section, Segmented, Select, Sheet, strokeIcon } from "../_ui";
import { lastSize, settings } from "./index";

// Lucide monitor / layout-grid / gauge / move-horizontal
const MONITORS_PATH = strokeIcon("M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M8 21h8", "M12 17v4");
const GRID_PATH = strokeIcon(
    "M4 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
    "M15 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
    "M15 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z",
    "M4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z"
);
const SPEED_PATH = strokeIcon("m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0");
const WIDTH_PATH = strokeIcon("m18 8 4 4-4 4", "M2 12h20", "m6 8-4 4 4 4");
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
                <Row leading={<Glyph path={SPEED_PATH} color="gray" />} title="Frame rate" subtitle="Per monitor" trailing={<Select value={fps} options={FPS} onChange={v => settings.store.fps = v} />} />
                <Row leading={<Glyph path={WIDTH_PATH} color="indigo" />} title="Widest picture" subtitle="Larger setups are scaled down" trailing={<Select value={maxWidth} options={WIDTHS} onChange={v => settings.store.maxWidth = v} />} />
            </Section>
            <Note>
                For readable text, set the stream quality to <b>1440p</b> or <b>Source</b> when you start the stream, and give it
                more bitrate with the StreamUnlock plugin (e.g. 15–20 Mbit/s) – otherwise Discord squeezes the picture hard.
            </Note>
        </Sheet>
    );
}, { noop: true });
