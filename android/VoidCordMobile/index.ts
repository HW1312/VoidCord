/*
 * VoidCordMobile – only in the Android build (node build.mjs --android). Always on, and turns on what the phone
 * app is for: Unter das OS (Vencord starts the dependencies of a plugin that is on).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "VoidCordMobile",
    description: "Turns on Unter das OS in the VoidCord Android app",
    about: "Part of the Android build of VoidCord. It keeps Unter das OS switched on, so encrypted messages from your PC can be read on your phone.",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    required: true,
    dependencies: ["Unter das OS"]
});
