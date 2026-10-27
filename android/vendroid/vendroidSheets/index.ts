/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "Sheets",
    authors: [{ name: "pai.pie", id: 1375697625864601650n }, Devs.thororen, Devs.nin0dev],
    description: "Turns modals into mobile friendly sheets",
    enabledByDefault: true,
    patches: [
        {
            find: '"data-mana-component":"modal"',
            replacement: [
                {
                    match: /\i\(\)\(\i.container/,
                    replace: '"vde-sheet-inner "+$&',
                },
                {
                    match: /\i\(\)\(\i.outerContainer/,
                    replace: '"vde-sheet-outer "+$&',
                },
            ]
        },
        {
            find: "this.props.closeModal(this.props.modalKey)",
            replacement: {
                match: /"div",{className:/,
                replace: '$&"vde-sheet-layer "+',
            },
        },
        {
            find: ',fullScreenOnMobile:"',
            replacement: {
                match: /fullScreenOnMobile:"\i"/,
                replace: 'fullScreenOnMobile:""',
            },
        },
        {
            find: "fullscreenOnMobile__",
            replacement: {
                match: /(\i):"fullscreenOnMobile__?[a-zA-Z0-9]+"/,
                replace: "$1:\"\""
            }
        }
    ],
});
