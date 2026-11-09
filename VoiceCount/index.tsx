/*
 * VoiceCount – Vencord Userplugin
 * The server tooltip (hovering a server in the list) shows who's in its voice channels as a row of avatars,
 * cut off at "+99". This shows the exact number instead – and how many of them are bots.
 *
 * How: the tooltip's rows (voice, streams, activities) all go through one small function that renders Discord's
 * avatar stack (UserSummaryItem, max 6). The patch turns off the stack's capped "+N" and adds a count after it.
 * UserSummaryItem itself is left alone – it's used all over Discord.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { User } from "@vencord/discord-types";

import { Icon, ICONS, strokeIcon } from "../_ui";

// Note: the users list is the one Discord shows (blocked / ignored people are already left out by Discord)

const cl = classNameFactory("vc-voicecount-");

/** Lucide "bot" */
const BOT_ICON = strokeIcon("M12 8V4H8", "M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z", "M2 14h2", "M20 14h2", "M15 13v2", "M9 13v2");

/**
 * One pill, right-aligned: real users, then (dimmed, after a thin divider) the bots – icon + number only, the
 * tooltip is narrow. The words and the total are in the hover text.
 */
function Count({ users }: { users: (User | null | undefined)[]; }) {
    const total = users.length;
    const bots = users.filter(u => u?.bot).length;
    const people = total - bots;
    return (
        <span className={cl("count")} title={`${total.toLocaleString()} in total: ${people.toLocaleString()} ${people === 1 ? "user" : "users"}, ${bots.toLocaleString()} ${bots === 1 ? "bot" : "bots"}`}>
            <span className={cl("part")}>
                <Icon path={ICONS.user} size={12} />
                {people.toLocaleString()}
            </span>
            {bots > 0 && (
                <>
                    <span className={cl("sep")} />
                    <span className={`${cl("part")} ${cl("bots")}`}>
                        <Icon path={BOT_ICON} size={12} />
                        {bots.toLocaleString()}
                    </span>
                </>
            )}
        </span>
    );
}

/**
 * Avatars before the pill (the stack shows max − 1 when there are more): fewer than Discord's 6, so the pill
 * always fits in the tooltip's width – 3 with the bot part, 4 without. A row that fits entirely stays as it is.
 */
function avatarMax(users: (User | null | undefined)[] | null) {
    if (!Array.isArray(users) || users.length <= 6) return 6;
    return users.some(u => u?.bot) ? 4 : 5;
}

export default definePlugin({
    name: "VoiceCount",
    description: "Server tooltip: the exact number of people in voice instead of \"+99\", and how many of them are bots",
    about: "Hover a server in the server list: instead of stopping at \"+99\", the tooltip shows exactly how many people are in its voice channels (and streams / activities), and how many of them are bots.",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Servers", "Voice"],

    patches: [
        {
            // GuildTooltip: every row (voice, streams, activities) renders the avatar stack with max:6
            find: '"GuildTooltip - nonBlockedUsers"',
            replacement: {
                match: /(\(0,\i\.jsx\)\(\i\.\i,\{guildId:\i,users:(\i),)max:6\}\)/,
                replace: "$1max:$self.avatarMax($2),hideMoreUsers:true}),$self.renderCount($2)"
            }
        }
    ],

    avatarMax,

    renderCount: (users: (User | null | undefined)[] | null) => Array.isArray(users) && users.length
        ? <ErrorBoundary key="vc-voicecount" noop><Count users={users} /></ErrorBoundary>
        : null
});
