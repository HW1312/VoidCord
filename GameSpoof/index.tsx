/*
 * GameSpoof – Vencord Userplugin
 * Pretends a detectable PC game is running, the same way Discord's own game detection reports it: the game shows as
 * your activity and Discord gets the play session like for a really detected game. Pick any game from Discord's list
 * of detectable games, one at a time. Real games you start keep being detected next to it.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, RestAPI } from "@webpack/common";

import { SettingsPanel } from "./ui";

const logger = new Logger("GameSpoof");

export interface Detectable {
    id: string;
    name: string;
    icon?: string;
    /** Windows executable as Discord knows it, e.g. "win64/game.exe" */
    exe: string;
    aliases: string[];
}

interface Running {
    app: Detectable;
    game: any;
}

export const settings = definePluginSettings({
    panel: {
        type: OptionType.COMPONENT,
        component: () => <SettingsPanel />
    },
    recent: {
        type: OptionType.CUSTOM,
        default: [] as Detectable[],
        hidden: true
    }
});

// ---------------------------------------------------------------- Detectable games

let detectable: Detectable[] | null = null;
let loading: Promise<Detectable[]> | null = null;

/** Discord's list of games it can detect (~25 000, 13 MB) – loaded once, only what we need is kept */
export function loadDetectable() {
    if (detectable) return Promise.resolve(detectable);
    loading ??= RestAPI.get({ url: "/applications/detectable" })
        .then(res => {
            detectable = (res.body as any[])
                .map(a => ({
                    id: a.id,
                    name: a.name,
                    icon: a.icon_hash ?? undefined,
                    exe: a.executables?.find((x: any) => x.os === "win32" && !x.is_launcher)?.name?.replace(/^>/, ""),
                    aliases: a.aliases ?? []
                }))
                .filter(a => a.exe);
            return detectable;
        })
        .finally(() => loading = null);
    return loading;
}

export const iconUrl = (app: Detectable) => app.icon && `https://cdn.discordapp.com/app-icons/${app.id}/${app.icon}.png?size=64`;

// ---------------------------------------------------------------- Fake running game

/**
 * Discord's own debug hook of the game detection: the game is put in front of the natively detected games and stays
 * there on every scan. From there everything runs like for a real game – activity, play session reports to Discord
 * (POST /activities on start, every 30 min and with the play time on stop). Only one game at a time.
 */
export const running = new Map<string, Running>();
export const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

const setDebugGame = (game: any) => FluxDispatcher.dispatch({ type: "RUNNING_GAME_SET_DEBUG_GAME", game } as any);

export function startGame(app: Detectable) {
    if (running.has(app.id)) return;
    const pid = Math.floor(Math.random() * 30000) + 1000;
    const folder = app.name.replace(/[/\\:*?"<>|]/g, "");
    const game = {
        cmdLine: `C:\\Program Files\\${folder}\\${app.exe.replaceAll("/", "\\")}`,
        exeName: app.exe.split("/").pop(),
        exePath: `c:/program files/${folder.toLowerCase()}/${app.exe}`,
        hidden: false,
        isLauncher: false,
        id: app.id,
        name: app.name,
        pid,
        pidPath: [pid],
        processName: app.name,
        start: Date.now()
    };

    // Replaces the game before – Discord closes its play session itself
    running.clear();
    running.set(app.id, { app, game });
    setDebugGame(game);
    settings.store.recent = [app, ...settings.store.recent.filter(a => a.id !== app.id)].slice(0, 8).map(a => ({ ...a }));
    logger.info("Started", app.name);
    emit();
}

export function stopGame(id: string) {
    const r = running.get(id);
    if (!r) return;
    running.delete(id);
    setDebugGame(null);
    logger.info("Stopped", r.app.name);
    emit();
}

export function stopAll() {
    for (const id of [...running.keys()]) stopGame(id);
}

export default definePlugin({
    name: "GameSpoof",
    description: "Pretend a detectable PC game is running, so Discord detects it like a real game (activity, game badges)",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Activity", "Fun"],
    // Plugin Hub shows a "Testing" badge: whether Discord counts these games for the Game Variety badge isn't proven yet
    testing: true,
    settings,

    stop() {
        stopAll();
    }
});
