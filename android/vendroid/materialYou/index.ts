/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { startClientTheme } from "@plugins/clientTheme/utils/styleUtils";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "MaterialYou",
    description: "(Experimental) Use Material You dynamic colors",
    authors: [Devs.nin0dev],
    start() {
        if (!window.VencordMobileNative.getAccentColor) {
            throw new Error("Update VendroidEnhanced to use the Plugin");
        }
        const th = JSON.parse(window.VencordMobileNative.getAccentColor());
        startClientTheme((document.documentElement.classList.contains("theme-dark") ? th.dark : th.light).split("#")[1]);
    }
});
