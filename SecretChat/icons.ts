/*
 * SecretChat – Line icons (Lucide, 24×24) as path strings for the kit's <Icon>. Strings only – JSX at module level
 * runs before React is ready and crashes all of Vencord.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { strokeIcon } from "../_ui";

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

/** Lucide "lock" (rect 3/11 18×11 rx 2) */
export const LOCK_ICON = strokeIcon("M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z", "M7 11V7a5 5 0 0 1 10 0v4");
/** Lucide "lock-open" */
export const UNLOCK_ICON = strokeIcon("M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z", "M7 11V7a5 5 0 0 1 9.9-1");
/** Lucide "users" */
export const USERS_ICON = strokeIcon("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", circle(9, 7, 4), "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75");
/** Lucide "shield" */
export const SHIELD_ICON = strokeIcon("M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z");
/** Lucide "send" */
export const SEND_ICON = strokeIcon("M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z", "m21.854 2.147-10.94 10.939");

// Media players
/** Lucide "pause" */
export const PAUSE_ICON = strokeIcon("M15 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", "M7 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z");
const SPEAKER = "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z";
/** Lucide "volume-2" */
export const VOLUME_ICON = strokeIcon(SPEAKER, "M16 9a5 5 0 0 1 0 6", "M19.364 18.364a9 9 0 0 0 0-12.728");
/** Lucide "volume-1" */
export const VOLUME_LOW_ICON = strokeIcon(SPEAKER, "M16 9a5 5 0 0 1 0 6");
/** Lucide "volume-x" */
export const MUTE_ICON = strokeIcon(SPEAKER, "m22 9-6 6", "m16 9 6 6");
/** Lucide "repeat" */
export const LOOP_ICON = strokeIcon("m17 2 4 4-4 4", "M3 11v-1a4 4 0 0 1 4-4h14", "m7 22-4-4 4-4", "M21 13v1a4 4 0 0 1-4 4H3");
/** Lucide "picture-in-picture-2" */
export const PIP_ICON = strokeIcon("M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4", "M14 13h6a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z");
/** Lucide "maximize-2" */
export const EXPAND_ICON = strokeIcon("M15 3h6v6", "m21 3-7 7", "m3 21 7-7", "M9 21H3v-6");
/** Lucide "maximize" */
export const FULLSCREEN_ICON = strokeIcon("M8 3H5a2 2 0 0 0-2 2v3", "M21 8V5a2 2 0 0 0-2-2h-3", "M3 16v3a2 2 0 0 0 2 2h3", "M16 21h3a2 2 0 0 0 2-2v-3");
/** Lucide "minimize" */
export const EXIT_FULLSCREEN_ICON = strokeIcon("M8 3v3a2 2 0 0 1-2 2H3", "M21 8h-3a2 2 0 0 1-2-2V3", "M3 16h3a2 2 0 0 1 2 2v3", "M16 21v-3a2 2 0 0 1 2-2h3");
/** Lucide "smartphone" */
export const PHONE_ICON = strokeIcon("M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M12 18h.01");
