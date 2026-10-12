/*
 * BadgeUnlock – catalog of Discord's profile badges
 * Icons are Discord's own badge pictures on its CDN (all checked 2026-10-12).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface BadgeDef {
    /** Discord's badge id */
    id: string;
    /** Icon hash on cdn.discordapp.com/badge-icons */
    icon: string;
    /** Name in the settings list */
    name: string;
    /** Tooltip on the profile; may depend on the date / user */
    description(ctx: { username: string; }): string;
    link?: string;
    /** Months of Nitro / boosting, used for the "since" date */
    months?: number;
}

export interface BadgeGroup {
    title: string;
    badges: BadgeDef[];
}

export const iconUrl = (icon: string) => `https://cdn.discordapp.com/badge-icons/${icon}.png`;

const PREMIUM_LINK = "https://discord.com/settings/premium";
const BUG_LINK = "https://support.discord.com/hc/en-us/articles/360046057772-Discord-Bugs";
const HOUSE_LINK = "https://discord.com/settings/hypesquad-online";

/** "Jan 5, 2024" for a date the given number of months ago */
function since(months: number) {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const fixed = (text: string) => () => text;

function nitro(id: string, icon: string, tier: string, months: number): BadgeDef {
    return { id, icon, name: `Nitro ${tier}`, months, link: PREMIUM_LINK, description: () => `Subscriber since ${since(months)}` };
}

function boost(level: number, icon: string, months: number): BadgeDef {
    const label = months === 1 ? "1 month" : `${months} months`;
    return {
        id: `guild_booster_lvl${level}`, icon, name: `Server Boost – ${label}`, months, link: PREMIUM_LINK,
        description: () => `Server boosting since ${since(months)}`
    };
}

export const GROUPS: BadgeGroup[] = [
    {
        title: "Discord",
        badges: [
            { id: "staff", icon: "5e74e9b61934fc1f67c65515d1f7e60d", name: "Discord Staff", link: "https://discord.com/company", description: fixed("Discord Staff") },
            { id: "partner", icon: "3f9748e53446a137a052f3454e2de41e", name: "Partnered Server Owner", link: "https://discord.com/partners", description: fixed("Partnered Server Owner") },
            { id: "certified_moderator", icon: "fee1624003e2fee35cb398e125dc479b", name: "Moderator Programs Alumni", link: "https://discord.com/safety", description: fixed("Moderator Programs Alumni") },
            { id: "early_supporter", icon: "7060786766c9c840eb3019e725d2b358", name: "Early Supporter", link: PREMIUM_LINK, description: fixed("Early Supporter") }
        ]
    },
    {
        title: "HypeSquad",
        badges: [
            { id: "hypesquad", icon: "bf01d1073931f921909045f3a39fd264", name: "HypeSquad Events", link: "https://discord.com/hypesquad", description: fixed("HypeSquad Events") },
            { id: "hypesquad_house_1", icon: "8a88d63823d8a71cd5e390baa45efa02", name: "HypeSquad Bravery", link: HOUSE_LINK, description: fixed("HypeSquad Bravery") },
            { id: "hypesquad_house_2", icon: "011940fd013da3f7fb926e4a1cd2e618", name: "HypeSquad Brilliance", link: HOUSE_LINK, description: fixed("HypeSquad Brilliance") },
            { id: "hypesquad_house_3", icon: "3aa41de486fa12454c3761e8e223442e", name: "HypeSquad Balance", link: HOUSE_LINK, description: fixed("HypeSquad Balance") }
        ]
    },
    {
        title: "Bug Hunter & Developer",
        badges: [
            { id: "bug_hunter_level_1", icon: "2717692c7dca7289b35297368a940dd0", name: "Bug Hunter", link: BUG_LINK, description: fixed("Discord Bug Hunter") },
            { id: "bug_hunter_level_2", icon: "848f79194d4be5ff5f81505cbd0ce1e6", name: "Bug Hunter (Gold)", link: BUG_LINK, description: fixed("Discord Bug Hunter") },
            { id: "active_developer", icon: "6bdc42827a38498929a4920da12695d9", name: "Active Developer", link: "https://support-dev.discord.com/hc/en-us/articles/10113997751447", description: fixed("Active Developer") },
            { id: "verified_developer", icon: "6df5892e0f35b051f8b61eace34f4967", name: "Early Verified Bot Developer", description: fixed("Early Verified Bot Developer") }
        ]
    },
    {
        title: "Nitro",
        badges: [
            { id: "premium", icon: "2ba85e8026a8614b640c2837bcdfe21b", name: "Nitro", months: 0, link: PREMIUM_LINK, description: () => `Subscriber since ${since(0)}` },
            nitro("premium_tenure_1_month_v2", "4f33c4a9c64ce221936bd256c356f91f", "Bronze (1 month)", 1),
            nitro("premium_tenure_3_month_v2", "4514fab914bdbfb4ad2fa23df76121a6", "Silver (3 months)", 3),
            nitro("premium_tenure_6_month_v2", "2895086c18d5531d499862e41d1155a6", "Gold (6 months)", 6),
            nitro("premium_tenure_12_month_v2", "0334688279c8359120922938dcb1d6f8", "Platinum (1 year)", 12),
            nitro("premium_tenure_24_month_v2", "0d61871f72bb9a33a7ae568c1fb4f20a", "Diamond (2 years)", 24),
            nitro("premium_tenure_36_month_v2", "11e2d339068b55d3a506cff34d3780f3", "Emerald (3 years)", 36),
            nitro("premium_tenure_60_month_v2", "cd5e2cfd9d7f27a8cdcd3e8a8d5dc9f4", "Ruby (5 years)", 60),
            nitro("premium_tenure_72_month_v2", "5b154df19c53dce2af92c9b61e6be5e2", "Opal (6+ years)", 72)
        ]
    },
    {
        title: "Server Boosting",
        badges: [
            boost(1, "51040c70d4f20a921ad6674ff86fc95c", 1),
            boost(2, "0e4080d1d333bc7ad29ef6528b6f2fb7", 2),
            boost(3, "72bed924410c304dbe3d00a6e593ff59", 3),
            boost(4, "df199d2050d3ed4ebf84d64ae83989f8", 6),
            boost(5, "996b3e870e8a22ce519b3a50e6bdd52f", 9),
            boost(6, "991c9f39ee33d7537d9f408c3e53141e", 12),
            boost(7, "cb3ae83c15e970e8f3d410bc62cb8b99", 15),
            boost(8, "7142225d31238f6387d9f09efaa02759", 18),
            boost(9, "ec92202290b48d0879b7413d2dde3bab", 24)
        ]
    },
    {
        title: "Other",
        badges: [
            { id: "legacy_username", icon: "6de6d34650760ba5551a79732e98ed60", name: "Originally known as", description: ({ username }) => `Originally known as ${username}#0001` },
            { id: "quest_completed", icon: "7d9ae358c8c5e118768335dbe68b4fb8", name: "Completed a Quest", link: "https://discord.com/discovery/quests", description: fixed("Completed a Quest") },
            { id: "orb_profile_badge", icon: "83d8a1eb09a8d64e59233eec5d4d5c2d", name: "Orbs Apprentice", link: "https://discord.com/shop", description: fixed("Orbs Apprentice") },
            { id: "bot_commands", icon: "6f9e37f9029ff57aef81db857890005e", name: "Supports Commands (bot)", description: fixed("Supports Commands") },
            { id: "automod", icon: "f2459b691ac7453ed6039bbcfaccbfcd", name: "Uses AutoMod (bot)", description: fixed("Uses AutoMod") }
        ]
    }
];

export const ALL_BADGES = GROUPS.flatMap(g => g.badges);
export const BADGE_BY_ID = new Map(ALL_BADGES.map(b => [b.id, b]));
/** Position of each badge in Discord's usual order */
export const ORDER = new Map(ALL_BADGES.map((b, i) => [b.id, i]));
