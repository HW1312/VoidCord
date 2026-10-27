/*
 * BadgeUnlock – Vencord Userplugin
 * Shows any of Discord's profile badges on your own profile and lets you pick each one.
 * Only you see them (it changes what your client renders, nothing is sent to Discord).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore } from "@webpack/common";

import { BADGE_BY_ID, ORDER } from "./badges";
import { SettingsPanel } from "./ui";

const logger = new Logger("BadgeUnlock");

export const settings = definePluginSettings({
    panel: {
        type: OptionType.COMPONENT,
        component: () => <SettingsPanel />
    },
    shown: {
        type: OptionType.CUSTOM,
        default: [] as string[],
        hidden: true
    },
    hideReal: {
        type: OptionType.BOOLEAN,
        description: "Hide the badges you really have",
        default: false,
        hidden: true
    }
});

// ---------------------------------------------------------------- Badges of the profile

interface NativeBadge {
    id: string;
    description: string;
    icon: string;
    link?: string;
}

/** Badges added by Vencord (donor badges, other plugins) have their own picture or component */
const isNative = (b: any) => typeof b?.icon === "string" && !b.iconSrc && !b.component;

function ownBadges(profile: { userId?: string; }, list: any[]): any[] {
    if (!Array.isArray(list) || profile?.userId == null) return list;
    const me = UserStore.getCurrentUser();
    if (!me || profile.userId !== me.id) return list;

    const shown = new Set(settings.store.shown);
    const { hideReal } = settings.store;
    if (!shown.size && !hideReal) return list;

    const vencord = list.filter(b => !isNative(b));
    const real = hideReal ? [] : list.filter(b => isNative(b) && !shown.has(b.id));
    const ctx = { username: me.username };

    const fake: NativeBadge[] = [];
    for (const id of shown) {
        const def = BADGE_BY_ID.get(id);
        if (def) fake.push({ id: def.id, icon: def.icon, description: def.description(ctx), link: def.link });
    }

    // Discord's usual order; real badges we don't know stay at the end
    const pos = (b: NativeBadge) => ORDER.get(b.id) ?? Infinity;
    return [...vencord, ...[...fake, ...real].sort((a, b) => pos(a) - pos(b))];
}

export default definePlugin({
    name: "BadgeUnlock",
    description: "Show any Discord badge on your own profile (Staff, Partner, HypeSquad, Nitro, Boosts …) and pick each one - only visible to you",
    about: "Put any Discord badge on your own profile and pick exactly which ones show. Only you can see them - nothing is sent to Discord.",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Appearance", "Customisation"],
    settings,

    patches: [
        {
            // UserProfile record: wrap getBadges() (also keeps the badges BadgeAPI adds, whichever patch runs first)
            find: "getLegacyUsername(){",
            replacement: {
                match: /getBadges\(\)\{(.{0,300}?\})(?=getLegacyUsername\(\)\{)/,
                replace: "getBadges(){return $self.ownBadges(this,this.vcBUOrig())}vcBUOrig(){$1"
            }
        }
    ],

    ownBadges(profile: { userId?: string; }, list: any[]) {
        try {
            return ownBadges(profile, list);
        } catch (e) {
            logger.error("Failed to build badges", e);
            return list;
        }
    }
});
