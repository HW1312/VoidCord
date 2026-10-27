/*
 * LinkCards – Vencord Userplugin
 * Live status cards under messages for Discord, YouTube, Twitch, Kick, X, Reddit, TikTok, GitHub, Steam and more.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

import { getEntry, isSettled, pruneCache, resetMemory } from "./cache";
import { logger, resetBackoffs } from "./net";
import { clearMatchMemo, findMatches, matchUrl } from "./providers";
import { LinkCardsAccessory, SettingsPanel } from "./ui";

// ---------------------------------------------------------------- Settings

export const settings = definePluginSettings({
    panel: {
        type: OptionType.COMPONENT,
        component: () => <SettingsPanel />
    },
    github: {
        type: OptionType.BOOLEAN,
        description: "GitHub cards (issues, PRs, repos, releases)",
        default: true,
        hidden: true
    },
    steam: {
        type: OptionType.BOOLEAN,
        description: "Steam cards (price, discount, reviews)",
        default: true,
        hidden: true
    },
    npm: {
        type: OptionType.BOOLEAN,
        description: "npm cards",
        default: true,
        hidden: true
    },
    pypi: {
        type: OptionType.BOOLEAN,
        description: "PyPI cards",
        default: true,
        hidden: true
    },
    crates: {
        type: OptionType.BOOLEAN,
        description: "crates.io cards",
        default: true,
        hidden: true
    },
    discord: {
        type: OptionType.BOOLEAN,
        description: "Discord invite cards",
        default: true,
        hidden: true
    },
    youtube: {
        type: OptionType.BOOLEAN,
        description: "YouTube cards",
        default: true,
        hidden: true
    },
    twitch: {
        type: OptionType.BOOLEAN,
        description: "Twitch cards",
        default: true,
        hidden: true
    },
    kick: {
        type: OptionType.BOOLEAN,
        description: "Kick cards",
        default: true,
        hidden: true
    },
    twitter: {
        type: OptionType.BOOLEAN,
        description: "X / Twitter cards",
        default: true,
        hidden: true
    },
    reddit: {
        type: OptionType.BOOLEAN,
        description: "Reddit cards",
        default: true,
        hidden: true
    },
    tiktok: {
        type: OptionType.BOOLEAN,
        description: "TikTok cards",
        default: true,
        hidden: true
    },
    bluesky: {
        type: OptionType.BOOLEAN,
        description: "Bluesky cards",
        default: true,
        hidden: true
    },
    wikipedia: {
        type: OptionType.BOOLEAN,
        description: "Wikipedia cards",
        default: true,
        hidden: true
    },
    roblox: {
        type: OptionType.BOOLEAN,
        description: "Roblox cards",
        default: true,
        hidden: true
    },
    modrinth: {
        type: OptionType.BOOLEAN,
        description: "Modrinth cards",
        default: true,
        hidden: true
    },
    google: {
        type: OptionType.BOOLEAN,
        description: "Google cards",
        default: true,
        hidden: true
    },
    githubToken: {
        type: OptionType.STRING,
        description: "GitHub Personal Access Token (only sent to api.github.com)",
        default: "",
        hidden: true
    },
    steamCountry: {
        type: OptionType.STRING,
        description: "Steam country for prices (ISO code, e.g. US, GB, DE)",
        default: "DE",
        hidden: true
    },
    onlyVisible: {
        type: OptionType.BOOLEAN,
        description: "Only load when the card is visible",
        default: true,
        hidden: true
    },
    // New key so everyone gets the replacement once (the old hideEmbeds defaulted to off)
    replaceEmbeds: {
        type: OptionType.BOOLEAN,
        description: "Show the card instead of Discord's own embed / invite card",
        default: true,
        hidden: true
    }
});

// ---------------------------------------------------------------- Replace original embeds

/** Key of the card shown for this link in this message, if any */
function cardKeyFor(url: string, message: any) {
    if (!settings.store.replaceEmbeds || !message?.content) return null;
    const m = matchUrl(url);
    if (!m || !findMatches(message.content).some(x => x.key === m.key)) return null;
    return m.key;
}

/** The card takes over the embed (incl. its media) once its first load has finished –
 *  if that failed, the card is built from the embed itself, so nothing gets lost */
function shouldIgnoreEmbed(embed: any, message: any) {
    try {
        const key = embed?.url && cardKeyFor(embed.url, message);
        return !!key && isSettled(key);
    } catch (e) {
        logger.error("Error in shouldIgnoreEmbed", e);
        return false;
    }
}

/** Discord's invite card – only replaced when the card has real data or knows the invite is invalid */
function shouldIgnoreInvite(code: string, message: any) {
    try {
        const key = code && cardKeyFor(`https://discord.gg/${code}`, message);
        const entry = key ? getEntry(key) : null;
        return !!entry && (entry.data != null || !!entry.notFound);
    } catch (e) {
        logger.error("Error in shouldIgnoreInvite", e);
        return false;
    }
}

// ---------------------------------------------------------------- Plugin

export default definePlugin({
    name: "LinkCards",
    description: "Live status cards under messages: Discord invites, YouTube/TikTok views, Twitch/Kick live status, X/Reddit/Bluesky posts, GitHub, Steam, Roblox, package versions and more – always up to date instead of a frozen embed",
    about: "Links to Discord, YouTube, Twitch, Kick, X, Reddit, TikTok, GitHub, Steam and more get a clean live card instead of Discord's embed - e.g. whether a stream is live, view counts or an invite's online members with a Join button.",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Chat", "Utility"],
    dependencies: ["MessageAccessoriesAPI", "MessageUpdaterAPI"],
    settings,

    patches: [
        {
            // Same pattern as FakeNitro: skip individual embeds in renderEmbeds
            find: "}renderStickersAccessories(",
            replacement: {
                match: /(renderEmbeds\((\i)\){)(.+?embeds\.map\(\((\i),\i\)?=>{)/,
                replace: (_, rest1, message, rest2, embed) => `${rest1}const vcLinkCardsMessage=${message};${rest2}if($self.shouldIgnoreEmbed(${embed},vcLinkCardsMessage))return null;`
            }
        },
        {
            // Discord's own "You received an invite" card
            find: "}renderStickersAccessories(",
            replacement: {
                match: /(renderCodedLinks\((\i)\){.+?case \i\.\i\.INVITE:)(?=if\(!this\.shouldRenderInvite\((\i)\)\))/,
                replace: "$1if($self.shouldIgnoreInvite($3,$2))return null;"
            }
        }
    ],

    shouldIgnoreEmbed,
    shouldIgnoreInvite,

    renderMessageAccessory: ({ message }) => {
        if (!message?.content || !findMatches(message.content).length) return null;
        return <LinkCardsAccessory message={message} />;
    },

    start() {
        pruneCache();
    },

    stop() {
        resetMemory();
        resetBackoffs();
        clearMatchMemo();
    }
});

