/*
 * GameSpoof – settings panel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getUserSettingLazy } from "@api/UserSettings";
import ErrorBoundary from "@components/ErrorBoundary";
import { useEffect, useMemo, useState } from "@webpack/common";

import { Avatar, Button, Empty, Note, Row, SearchField, Section, Sheet, Spinner, strokeIcon, ToggleRow, useListener } from "../_ui";
import { Detectable, iconUrl, listeners, loadDetectable, running, settings, startGame, stopGame } from "./index";

// Lucide gamepad-2 / eye
const GAMEPAD = strokeIcon("M6 11h4", "M8 9v4", "M15 12h.01", "M18 10h.01", "M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z");
const HEADER = { title: "Game Spoof", icon: GAMEPAD, iconColor: "indigo" } as const;
const MAX_RESULTS = 40;
const EYE = strokeIcon("M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0", "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0");

/** Discord's "Share your detected activities with others" – without it only you see the game */
const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;

function played(start: number) {
    const min = Math.floor((Date.now() - start) / 60_000);
    return min < 1 ? "just started" : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

function GameRow({ app }: { app: Detectable; }) {
    const r = running.get(app.id);
    return (
        <Row
            leading={<Avatar src={iconUrl(app) || undefined} fallback={GAMEPAD} square size={32} />}
            title={app.name}
            subtitle={r ? `Playing · ${played(r.game.start)}` : app.exe}
            trailing={r
                ? <Button small variant="tinted" color="red" onClick={() => stopGame(app.id)}>Stop</Button>
                : <Button small variant="tinted" onClick={() => startGame(app)}>Play</Button>}
        />
    );
}

export const SettingsPanel = ErrorBoundary.wrap(() => {
    useListener(listeners);
    const { recent } = settings.use(["recent"]);
    const shared = ShowCurrentGame.useSetting();
    const [query, setQuery] = useState("");
    const [games, setGames] = useState<Detectable[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [, tick] = useState(0);

    // Playtime in the rows
    useEffect(() => {
        const t = setInterval(() => tick(n => n + 1), 30_000);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        if (!query.trim() || games) return;
        loadDetectable().then(setGames, e => setError(String(e?.message ?? e)));
    }, [query]);

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q || !games) return [];
        const hits = games.filter(g => g.name.toLowerCase().includes(q) || g.aliases.some(a => a.toLowerCase().includes(q)));
        // Names starting with the query first
        hits.sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.length - b.name.length);
        return hits.slice(0, MAX_RESULTS);
    }, [query, games]);

    const playing = [...running.values()].map(r => r.app);
    const recentIdle = recent.filter(a => !running.has(a.id));

    return (
        <Sheet embedded header={{ ...HEADER, subtitle: playing.length ? `Playing ${playing.length} game${playing.length > 1 ? "s" : ""}` : "No game running", live: playing.length > 0 }}>
            <Note>One game at a time – starting another one ends the one before, like closing a real game. Discord saves the play session with its play time when the game stops. The game stops when Discord restarts.</Note>

            <Section footer={shared ? undefined : "Off: Discord shows the game only to you (bottom left), others don't see it on your profile."}>
                <ToggleRow
                    icon={EYE}
                    color={shared ? "green" : "gray"}
                    title="Show the game to others"
                    subtitle={"Discord's \"Share your detected activities\" setting"}
                    checked={!!shared}
                    onChange={v => ShowCurrentGame.updateSetting(v)}
                />
            </Section>

            {playing.length > 0 && (
                <Section title="Running">
                    {playing.map(app => <GameRow key={app.id} app={app} />)}
                </Section>
            )}

            {recentIdle.length > 0 && !query && (
                <Section title="Recent">
                    {recentIdle.map(app => <GameRow key={app.id} app={app} />)}
                </Section>
            )}

            <Section title="Detectable games" footer={games && query ? `${results.length === MAX_RESULTS ? `First ${MAX_RESULTS}` : results.length} of ${games.length} games` : undefined}>
                <SearchField value={query} onChange={setQuery} placeholder="Search a game, e.g. Minecraft" />
                {error
                    ? <Empty icon={GAMEPAD} title="Couldn't load the game list" hint={error} />
                    : !query.trim()
                        ? null
                        : !games
                            ? <Row leading={<Spinner />} title="Loading Discord's game list…" />
                            : results.length
                                ? results.map(app => <GameRow key={app.id} app={app} />)
                                : <Empty icon={GAMEPAD} title="No game found" hint="Only games Discord can detect are in the list." />}
            </Section>
        </Sheet>
    );
}, { noop: true });
