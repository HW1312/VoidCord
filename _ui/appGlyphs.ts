/*
 * Plugin app icons ("artwork"): one duotone line icon per plugin on the 24 px Lucide grid.
 * base = white strokes, accent = the part drawn in the plugin's color. Rendered by AppArtwork in index.tsx.
 * Key = plugin name as shown (spaces and case don't matter for lookups).
 */

import type { UiColor } from "./index";

export interface AppGlyph { color: UiColor; base: string[]; accent: string[]; }

/** Circle as path data */
const c = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
/** Rounded rectangle as path data */
const rect = (x: number, y: number, w: number, h: number, r: number) =>
    `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

const MONITOR = [rect(2, 3, 20, 14, 2), "M8 21h8", "M12 17v4"];
const MESSAGE = "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z";
const SHIELD = "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";

export const APP_GLYPHS: Record<string, AppGlyph> = {
    // two screens at once
    AllScreens: {
        color: "teal",
        base: ["M7 3h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-1", rect(2, 7, 15, 10, 2)],
        accent: ["M6.5 21h6", "M9.5 17v4"]
    },
    // music → activity
    Auralis: {
        color: "green",
        base: ["M9 18V5l12-2v13"],
        accent: [c(6, 18, 3), c(18, 16, 3)]
    },
    AutoQuest: {
        color: "yellow",
        base: ["M6 9H4.5a2.5 2.5 0 0 1 0-5H6", "M18 9h1.5a2.5 2.5 0 0 0 0-5H18", "M4 22h16", "M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22", "M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"],
        accent: ["M18 2H6v7a6 6 0 0 0 12 0V2Z"]
    },
    BadgeUnlock: {
        color: "blue",
        base: ["M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"],
        accent: ["m9 12 2 2 4-4"]
    },
    // instant replay: clock turning back
    CallClips: {
        color: "red",
        base: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"],
        accent: ["M12 7v5l4 2"]
    },
    ChatPopout: {
        color: "teal",
        base: ["M21 13v2a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h7"],
        accent: ["M16 3h5v5", "m21 3-7 7"]
    },
    // short videos on a phone
    DoomScroll: {
        color: "pink",
        base: [rect(5, 2, 14, 20, 2), "M10 19h4"],
        accent: ["m10 8 5 3-5 3z"]
    },
    // muted mic that still talks
    FakeMute: {
        color: "orange",
        base: ["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3"],
        accent: ["m3 3 18 18"]
    },
    FakeRobux: {
        color: "green",
        base: ["M18.09 10.37A6 6 0 1 1 10.34 18", "m16.71 13.88.7.71-2.82 2.82"],
        accent: [c(8, 8, 6), "M7 6h1v4"]
    },
    FormatHub: {
        color: "indigo",
        base: ["M4 7V4h16v3", "M12 4v14", "M9 18h6"],
        accent: ["M5 22h14"]
    },
    // picture in picture
    FreePiP: {
        color: "blue",
        base: ["M21 10V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5"],
        accent: [rect(12, 13, 10, 7, 2)]
    },
    FriendDock: {
        color: "green",
        base: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", c(9, 7, 4)],
        accent: ["M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"]
    },
    GameSpoof: {
        color: "purple",
        base: ["M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"],
        accent: ["M6 11h4", "M8 9v4", "M15 12h.01", "M18 10h.01"]
    },
    GofileUpload: {
        color: "blue",
        base: ["M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"],
        accent: ["M12 13v8", "m8 17 4-4 4 4"]
    },
    HomeOrganizer: {
        color: "blue",
        base: ["M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],
        accent: ["M22 12h-6l-2 3h-4l-2-3H2"]
    },
    // picture with text on it
    ImageText: {
        color: "orange",
        base: [rect(3, 3, 18, 18, 2), "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"],
        accent: ["M7 7.5h6", "M10 7.5v6"]
    },
    LinkCards: {
        color: "indigo",
        base: ["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"],
        accent: ["M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"]
    },
    MediaGallery: {
        color: "pink",
        base: ["M18 22H4a2 2 0 0 1-2-2V6", rect(6, 2, 16, 16, 2)],
        accent: ["m22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18", c(12, 8, 2)]
    },
    // video from a link → file
    MediaGrab: {
        color: "red",
        base: [rect(2, 3, 20, 13, 2), "m10 7 4.5 2.5L10 12z"],
        accent: ["M12 16v6", "m9 19 3 3 3-3"]
    },
    MessageSelect: {
        color: "blue",
        base: [MESSAGE],
        accent: ["m8 10 2.5 2.5L16 7"]
    },
    // gavel
    ModKit: {
        color: "orange",
        base: ["m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8"],
        accent: ["m16 16 6-6", "m8 8 6-6", "m9 7 8 8", "m21 11-8-8"]
    },
    OpSec: {
        color: "green",
        base: [SHIELD],
        accent: [c(12, 10.5, 1.75), "M12 12.25V15"]
    },
    PeekAnything: {
        color: "teal",
        base: ["M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"],
        accent: [c(12, 12, 3)]
    },
    // dice
    PeopleRoulette: {
        color: "pink",
        base: [rect(3, 3, 18, 18, 3)],
        accent: [c(8, 8, 0.6), c(16, 8, 0.6), c(12, 12, 0.6), c(8, 16, 0.6), c(16, 16, 0.6)]
    },
    PluginHub: {
        color: "purple",
        base: [rect(3, 3, 7, 7, 1.5), rect(3, 14, 7, 7, 1.5), rect(14, 14, 7, 7, 1.5)],
        accent: [rect(14, 3, 7, 7, 1.5)]
    },
    Radar: {
        color: "green",
        base: ["M19.07 4.93A10 10 0 0 0 6.99 3.34", "M4 6h.01", "M2.29 9.62A10 10 0 1 0 21.31 8.35", "M16.24 7.76A6 6 0 1 0 8.23 16.67", "M12 18h.01", "M17.99 11.66A6 6 0 0 1 15.77 16.67"],
        accent: [c(12, 12, 2), "m13.41 10.59 5.66-5.66"]
    },
    // a shrinking list and a sparkle
    ServerDeclutter: {
        color: "mint",
        base: ["M3 6h11", "M3 12h8", "M3 18h5"],
        accent: ["M18 9.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"]
    },
    ServerTools: {
        color: "indigo",
        base: [rect(2, 2, 20, 8, 2), rect(2, 14, 20, 8, 2)],
        accent: ["M6 6h.01", "M6 18h.01", "M10 6h6", "M10 18h6"]
    },
    SilentMode: {
        color: "purple",
        base: ["M10.268 21a2 2 0 0 0 3.464 0", "M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742", "M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05"],
        accent: ["m2 2 20 20"]
    },
    SongRadar: {
        color: "pink",
        base: ["M16.24 7.76a6 6 0 0 1 0 8.49", "M7.76 16.24a6 6 0 0 1 0-8.49", "M19.07 4.93a10 10 0 0 1 0 14.14", "M4.93 19.07a10 10 0 0 1 0-14.14"],
        accent: [c(12, 12, 2)]
    },
    SplitView: {
        color: "teal",
        base: [rect(3, 3, 18, 18, 2)],
        accent: ["M12 3v18"]
    },
    // something laid over the stream
    StreamOverlay: {
        color: "purple",
        base: MONITOR,
        accent: [rect(5, 6, 6, 4, 1)]
    },
    StreamThumbnail: {
        color: "orange",
        base: MONITOR,
        accent: ["m5.5 14 3.5-3.5 2.5 2.5 3-3.5 4 4.5"]
    },
    // speedometer (FPS)
    StreamUnlock: {
        color: "red",
        base: ["M3.34 19a10 10 0 1 1 17.32 0"],
        accent: ["m12 14 4-4", c(12, 14, 0.5)]
    },
    ToolbarManager: {
        color: "blue",
        base: ["M21 4h-7", "M10 4H3", "M21 12h-9", "M8 12H3", "M21 20h-5", "M12 20H3"],
        accent: ["M14 2v4", "M8 10v4", "M16 18v4"]
    },
    // encrypted chat ("Unter das OS" = SecretChat)
    UnterdasOS: {
        color: "purple",
        base: [MESSAGE],
        accent: [c(12, 8.5, 1.75), "M12 10.25V13"]
    },
    UpdateButton: {
        color: "green",
        base: ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"],
        accent: ["M12 8v7", "m9 12 3 3 3-3"]
    },
    // waveform with a stopwatch
    VoiceLength: {
        color: "orange",
        base: ["M2 10v3", "M6 6v11", "M10 3v18", "M14 8v7"],
        accent: [c(19, 16, 3.5), "M19 14.5v1.5l1 1"]
    },
    Wrapped: {
        color: "pink",
        base: [rect(3, 8, 18, 4, 1), "M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"],
        accent: ["M12 8v13", "M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"]
    }
};
