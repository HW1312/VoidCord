/*
 * ServerTools – Vencord Userplugin
 * Invite list: click the inviter to open their profile, right-click for ID and name.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyWithToast, openUserProfile } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { ContextMenuApi, Menu } from "@webpack/common";
import type { MouseEvent } from "react";

const log = new Logger("ServerTools");

interface Inviter {
    id: string;
    username: string;
}

function openProfile(id: string) {
    openUserProfile(id).catch(e => log.error("Couldn't open profile", e));
}

function InviterMenu({ user }: { user: Inviter; }) {
    return (
        <Menu.Menu navId="vc-servertools-inviter" onClose={ContextMenuApi.closeContextMenu} aria-label="Inviter">
            <Menu.MenuItem id="vc-servertools-inviter-profile" label="Open profile" action={() => openProfile(user.id)} />
            <Menu.MenuItem id="vc-servertools-inviter-id" label="Copy user ID" action={() => copyWithToast(user.id, "User ID copied")} />
            <Menu.MenuItem id="vc-servertools-inviter-name" label="Copy username" action={() => copyWithToast(user.username, "Username copied")} />
            <Menu.MenuItem id="vc-servertools-inviter-mention" label="Copy mention" action={() => copyWithToast(`<@${user.id}>`, "Mention copied")} />
        </Menu.Menu>
    );
}

/** Extra props for the inviter cell of an invite row (patched into Discord's row component). */
export function inviterProps(user: Inviter | null | undefined) {
    if (!user?.id) return {};
    return {
        style: { cursor: "pointer" },
        title: "Open profile (right-click for more)",
        onClick: (e: MouseEvent) => {
            e.stopPropagation();
            openProfile(user.id);
        },
        onContextMenu: (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            ContextMenuApi.openContextMenu(e, () => <InviterMenu user={user} />);
        }
    };
}
