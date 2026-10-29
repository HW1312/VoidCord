/*
 * FakeRobux – Vencord Userplugin
 * Your real Roblox profile with a Robux balance you choose, in a window from the title bar.
 * "Send" simulates donations and gifts to real Roblox users:
 * nothing is sent anywhere and nobody gets anything. Only reads Roblox's public API, never logs in.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

import { titleBarSlot } from "../_ui";
import { renderTitleBarButton, SettingsPanel } from "./ui";

export interface HistoryEntry {
    id: string;
    kind: "donate" | "gift";
    at: number;
    amount: number;
    userId: number;
    username: string;
    displayName: string;
    message?: string;
    item?: { id: number; itemType: "Asset" | "Bundle"; name: string; };
}

export interface RecentUser { id: number; name: string; displayName: string; verified: boolean; }

const MAX_HISTORY = 200;
const MAX_RECENT = 3;

export const settings = definePluginSettings({
    panel: {
        type: OptionType.COMPONENT,
        component: () => <SettingsPanel />
    },
    username: {
        type: OptionType.STRING,
        description: "Your Roblox username",
        default: "",
        hidden: true
    },
    userId: {
        type: OptionType.CUSTOM,
        default: 0 as number,
        hidden: true
    },
    balance: {
        type: OptionType.CUSTOM,
        default: 1000 as number,
        hidden: true
    },
    showTitleBarButton: {
        type: OptionType.BOOLEAN,
        description: "Show the Roblox icon in the title bar",
        default: true,
        hidden: true
    },
    history: {
        type: OptionType.CUSTOM,
        default: [] as HistoryEntry[],
        hidden: true
    },
    /** Last users opened in Send, newest first */
    recentSearches: {
        type: OptionType.CUSTOM,
        default: [] as RecentUser[],
        hidden: true
    }
});

export const MAX_BALANCE = 999_999_999_999;

export function setBalance(value: number) {
    settings.store.balance = Math.max(0, Math.min(MAX_BALANCE, Math.floor(Number(value) || 0)));
}

/** Takes the Robux and writes the (simulated) transaction into the history. false = not enough Robux. */
export function spend(entry: Omit<HistoryEntry, "id" | "at">) {
    if (entry.amount > settings.store.balance) return false;
    setBalance(settings.store.balance - entry.amount);
    const full: HistoryEntry = { ...entry, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now() };
    // Settings recursively proxies records; copy them before saving through Electron IPC.
    const history = settings.store.history.map(entry => ({
        ...entry,
        item: entry.item && { ...entry.item }
    }));
    settings.store.history = [full, ...history].slice(0, MAX_HISTORY);
    return full;
}

export function addRecent(u: RecentUser) {
    const entry = { id: u.id, name: u.name, displayName: u.displayName, verified: u.verified };
    settings.store.recentSearches = [entry, ...settings.store.recentSearches.filter(r => r.id !== u.id).map(r => ({ ...r }))].slice(0, MAX_RECENT);
}

export function removeRecent(id: number) {
    settings.store.recentSearches = settings.store.recentSearches.filter(r => r.id !== id).map(r => ({ ...r }));
}

export default definePlugin({
    name: "FakeRobux",
    description: "Your real Roblox profile with any Robux balance you like, plus simulated donations and gifts to real Roblox users - from the title bar",
    about: "Shows your real Roblox profile with any Robux balance you like, and lets you \"send\" Robux to real users. Everything is simulated - nothing is ever sent and nobody gets anything.",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Fun", "Utility"],
    settings,

    patches: [
        {
            // Title bar on the left (next to Back/Forward & Inbox): append the button at the end
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /(leading:.{0,2500}?)\]\}\),title:/,
                replace: "$1,$self.renderTitleBarButton()]}),title:"
            }
        }
    ],

    renderTitleBarButton: titleBarSlot("FakeRobux", renderTitleBarButton)
});
