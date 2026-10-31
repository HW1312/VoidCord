/*
 * Wrapped – dashboard modal, settings panel & title bar button
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { saveFile } from "@utils/web";
import { findComponentByCodeLazy } from "@webpack";
import { ChannelStore, GuildStore, IconUtils, showToast, useEffect, useMemo, UserStore, useState } from "@webpack/common";

import { Avatar, Button, confirm, Empty as UiEmpty, Glyph, Icon, ICONS as UI, Note, openWindow, Progress, Row, Section, Segmented, Select, Sheet, Stats, strokeIcon, ToggleRow } from "../_ui";
import { AllTimeData, cancelBackfill, clearAllTime, getBackfill, onBackfillChange, runBackfill } from "./backfill";
import { BarChart, cl, Heatmap, MeterRow } from "./charts";
import { settings } from "./index";
import { aggregate, combine, fmtDuration, fmtHours, fmtNum, funFacts, Metric, Period, PERIODS, top } from "./stats";
import { exportJson, flushStats, getStats, isLoaded, onStatsChange, resetStats } from "./store";
import { userName } from "./tracker";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

// ---------------------------------------------------------------- Icons

/** Circle as path data (for Lucide icons drawn with strokeIcon) */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

const ICONS = {
    chart: strokeIcon("M3 3v16a2 2 0 0 0 2 2h16", "M18 17V9", "M13 17V5", "M8 17v-3"),
    voice: strokeIcon("M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3"),
    message: strokeIcon("M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"),
    clock: UI.clock,
    game: strokeIcon("M6 11h4", "M8 9v4", "M15 12h.01", "M18 10h.01", "M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"),
    at: strokeIcon(circle(12, 12, 4), "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"),
    hash: UI.hash,
    reset: strokeIcon("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"),
    timer: strokeIcon("M10 2h4", "M12 14l3-3", circle(12, 14, 8))
};

// ---------------------------------------------------------------- Hooks

function useStats() {
    const [, setTick] = useState(0);
    useEffect(() => onStatsChange(() => setTick(t => t + 1)), []);
    return getStats();
}

function useBackfill() {
    const [, setTick] = useState(0);
    useEffect(() => onBackfillChange(() => setTick(t => t + 1)), []);
    return getBackfill();
}

// ---------------------------------------------------------------- Names & pictures

const cachedName = (id: string) => getStats().names[id];

function userLabel(id: string) {
    return userName(UserStore.getUser(id)) ?? cachedName(id) ?? "Unknown user";
}

function placeLabel(id: string) {
    if (id === "@me") return "Direct messages";
    return GuildStore.getGuild(id)?.name ?? cachedName(id) ?? "Unknown server";
}

function channelLabel(id: string): { name: string; sub?: string; } {
    const c = ChannelStore.getChannel(id);
    if (!c) return { name: cachedName(id) ?? "Unknown channel" };
    if (c.type === 1) return { name: "@" + userLabel(c.recipients?.[0]), sub: "Direct message" };
    if (c.type === 3) return { name: c.name || cachedName(id) || "Group DM", sub: "Group DM" };
    return { name: "#" + c.name, sub: placeLabel(c.guild_id) };
}

const UserPic = ({ id }: { id: string; }) => {
    const user = UserStore.getUser(id);
    let src: string | undefined;
    try { src = user ? user.getAvatarURL(undefined, 64, false) : IconUtils.getDefaultAvatarURL(id); } catch { /* ignore */ }
    return <Avatar src={src} />;
};

function PlacePic({ id }: { id: string; }) {
    if (id === "@me") return <Avatar fallback={ICONS.at} />;
    const g = GuildStore.getGuild(id);
    let src: string | undefined;
    try { if (g?.icon) src = IconUtils.getGuildIconURL({ id, icon: g.icon, size: 64 }); } catch { /* ignore */ }
    return <Avatar src={src} square />;
}

const SymbolPic = ({ icon }: { icon: string; }) => <Avatar fallback={icon} square />;

const Empty = ({ children }: { children: string; }) => <Row dim title={<span className={cl("empty")}>{children}</span>} />;

const dateLong = (t: number | Date) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const METRICS: { value: Metric; label: string; }[] = [
    { value: "messages", label: "Messages" },
    { value: "voice", label: "Voice" },
    { value: "active", label: "Active" }
];

// ---------------------------------------------------------------- All-time (search backfill)

function AllTime() {
    const bf = useBackfill();
    const data: AllTimeData | null = bf.result;
    const totalMine = data ? data.guilds.reduce((a, g) => a + g.mine, 0) + data.dms.reduce((a, d) => a + d.mine, 0) : 0;
    const guilds = data?.guilds.filter(g => g.mine > 0).slice(0, 8) ?? [];
    const dms = data?.dms.filter(d => (d.total ?? 0) > 0).slice(0, 8) ?? [];
    const gMax = Math.max(1, ...guilds.map(g => g.mine));
    const dMax = Math.max(1, ...dms.map(d => d.total ?? 0));

    const button = bf.running
        ? <Button small variant="gray" onClick={cancelBackfill}>Stop</Button>
        : <Button small variant="tinted" icon={UI.search} onClick={() => void runBackfill()}>{data ? "Count again" : "Count my messages"}</Button>;

    return (
        <>
            <Section
                title="All-time (from Discord search)"
                right={button}
                footer="Counts every message you ever sent per server and in your 25 most recent DMs, using Discord's search. Runs slowly on purpose (one request every ~1.5 s) to respect rate limits. These numbers are separate from the tracked stats above."
            >
                {bf.running && (
                    <Row title={`${bf.done} / ${bf.total}`} subtitle={bf.waiting ? `Waiting ${bf.waiting}s (rate limit or search index)…` : bf.label}>
                        <Progress value={bf.total ? bf.done / bf.total : 0} />
                    </Row>
                )}
                {data && !bf.running && (
                    <Row
                        title={<span className={cl("alltime-num")}>{fmtNum(totalMine)}</span>}
                        subtitle={`messages sent in total · counted ${dateLong(data.at)}`}
                    />
                )}
                {!bf.running && !data && <Empty>Not counted yet.</Empty>}
            </Section>
            {bf.error && <Note tone="bad">{bf.error}</Note>}

            {data && !bf.running && (
                <div className={cl("cols")}>
                    <Section title="Servers">
                        {guilds.map(g => <MeterRow key={g.id} icon={<PlacePic id={g.id} />} name={GuildStore.getGuild(g.id)?.name ?? g.name} value={g.mine} max={gMax} label={fmtNum(g.mine)} />)}
                        {!guilds.length && <Empty>No messages found.</Empty>}
                    </Section>
                    <Section title="DMs (messages exchanged)">
                        {dms.map(d => (
                            <MeterRow
                                key={d.id}
                                icon={d.userId ? <UserPic id={d.userId} /> : <Avatar />}
                                name={d.userId ? userLabel(d.userId) : d.name}
                                sub={`${fmtNum(d.mine)} by you · ${fmtNum((d.total ?? 0) - d.mine)} by them`}
                                value={d.total ?? 0}
                                max={dMax}
                                label={fmtNum(d.total ?? 0)}
                            />
                        ))}
                        {!dms.length && <Empty>No DMs counted.</Empty>}
                    </Section>
                </div>
            )}
        </>
    );
}

// ---------------------------------------------------------------- Dashboard

function Dashboard({ period }: { period: Period; }) {
    const stats = useStats();
    const [metric, setMetric] = useState<Metric>("messages");

    // Re-aggregate when data changes (stats object is mutated in place → depend on a counter)
    const [version, setVersion] = useState(0);
    useEffect(() => onStatsChange(() => setVersion(v => v + 1)), []);
    const agg = useMemo(() => aggregate(period), [period, version, stats]);

    const games = top(agg.games, 6);
    const people = top(agg.voiceWith, 8);
    const dms = combine(agg.dmSent, agg.dmReceived, 8);
    const places = combine(agg.msgPlaces, agg.voicePlaces, 8);
    const channels = top(agg.msgChannels, 6);
    const voiceChannels = top(agg.voiceChannels, 4);
    const facts = useMemo(() => funFacts(agg, games[0]), [agg]);

    const hasData = agg.messages + agg.voice + agg.active > 0;
    const max = (rows: [string, number][]) => Math.max(1, ...rows.map(r => r[1]));
    const dmMax = Math.max(1, ...dms.map(d => d.a + d.b));
    const placeMsgMax = Math.max(1, ...places.map(p => p.a));
    const hours = (v: string) => <>{v}<span className={cl("unit")}>h</span></>;

    return (
        <>
            {!isLoaded() && <UiEmpty icon={ICONS.chart} title="Loading…" />}

            <Stats items={[
                { value: hours(fmtHours(agg.voice)), label: "in voice", color: "green" },
                { value: fmtNum(agg.messages), label: "messages sent", color: "blue" },
                { value: hours(fmtHours(agg.active)), label: "active on Discord", color: "orange" },
                {
                    value: <span className={cl("game")}>{games[0]?.[0] ?? "–"}</span>,
                    label: games[0] ? `top game · ${fmtDuration(games[0][1])}` : "no games tracked",
                    color: "pink",
                    title: games[0]?.[0]
                }
            ]} />

            {!hasData && isLoaded() && (
                <UiEmpty icon={ICONS.chart} title="Nothing tracked in this period yet" hint="Stats are collected from now on while Discord is open – check back in a few days." />
            )}

            <Section title="Activity" right={<Segmented<Metric> small value={metric} options={METRICS} onChange={setMetric} />} plain>
                <div className={cl("chart-card")}>
                    <BarChart days={agg.days} metric={metric} />
                    <div className={cl("sub-title")}>When you are on Discord</div>
                    <Heatmap agg={agg} metric={metric} />
                </div>
            </Section>

            <div className={cl("cols")}>
                <Section title="Top people in voice">
                    {people.map(([id, secs]) => <MeterRow key={id} icon={<UserPic id={id} />} name={userLabel(id)} value={secs} max={max(people)} label={fmtDuration(secs)} />)}
                    {!people.length && <Empty>No voice time with others yet.</Empty>}
                </Section>
                <Section title="Top DMs">
                    {dms.map(d => (
                        <MeterRow
                            key={d.id}
                            icon={<UserPic id={d.id} />}
                            name={userLabel(d.id)}
                            sub={`${fmtNum(d.a)} sent · ${fmtNum(d.b)} received`}
                            value={d.a + d.b}
                            max={dmMax}
                            label={fmtNum(d.a + d.b)}
                        />
                    ))}
                    {!dms.length && <Empty>No DMs yet.</Empty>}
                </Section>
            </div>

            <div className={cl("cols")}>
                <Section title="Top servers">
                    {places.map(p => (
                        <MeterRow
                            key={p.id}
                            icon={<PlacePic id={p.id} />}
                            name={placeLabel(p.id)}
                            sub={p.b ? `${fmtDuration(p.b)} in voice` : undefined}
                            value={p.a}
                            max={placeMsgMax}
                            label={`${fmtNum(p.a)} msgs`}
                        />
                    ))}
                    {!places.length && <Empty>No server activity yet.</Empty>}
                </Section>
                <Section title="Top channels">
                    {channels.map(([id, n]) => {
                        const { name, sub } = channelLabel(id);
                        return <MeterRow key={id} icon={<SymbolPic icon={ICONS.hash} />} name={name} sub={sub} value={n} max={max(channels)} label={fmtNum(n)} />;
                    })}
                    {voiceChannels.length > 0 && <Row dim title={<span className={cl("sub-title")}>Voice channels</span>} />}
                    {voiceChannels.map(([id, secs]) => {
                        const { name, sub } = channelLabel(id);
                        return <MeterRow key={id} icon={<SymbolPic icon={ICONS.voice} />} name={name.replace(/^#/, "")} sub={sub} value={secs} max={max(voiceChannels)} label={fmtDuration(secs)} />;
                    })}
                    {!channels.length && !voiceChannels.length && <Empty>No channel activity yet.</Empty>}
                </Section>
            </div>

            {games.length > 0 && (
                <Section title="Games">
                    {games.map(([name, secs]) => <MeterRow key={name} icon={<SymbolPic icon={ICONS.game} />} name={name} value={secs} max={max(games)} label={fmtDuration(secs)} />)}
                </Section>
            )}

            {facts.length > 0 && (
                <Section title="Fun facts">
                    {facts.map(f => <Row key={f.text} leading={<span className={cl("fact-emoji")}>{f.emoji}</span>} title={f.text} />)}
                </Section>
            )}

            <AllTime />
        </>
    );
}

function WrappedWindow({ close }: { close(): void; }) {
    const stats = useStats();
    const [period, setPeriod] = useState<Period>("30");
    return (
        <Sheet
            onClose={close}
            height="min(760px, 85vh)"
            header={{
                title: "Wrapped",
                subtitle: `Tracking since ${dateLong(stats.since)} · stored only on this device`,
                icon: ICONS.chart,
                iconColor: "purple"
            }}
            top={<Segmented<Period> value={period} options={PERIODS.map(p => ({ value: p.id, label: p.label }))} onChange={setPeriod} />}
        >
            <ErrorBoundary noop>
                <Dashboard period={period} />
            </ErrorBoundary>
        </Sheet>
    );
}

export function openWrappedModal() {
    void flushStats();
    openWindow(close => <WrappedWindow close={close} />, { size: "large" });
}

// ---------------------------------------------------------------- Settings

function exportData() {
    const json = exportJson(getBackfill().result);
    const filename = `wrapped-${new Date().toISOString().slice(0, 10)}.json`;
    const data = new TextEncoder().encode(json);
    if (IS_DISCORD_DESKTOP) DiscordNative.fileManager.saveWithDialog(data, filename);
    else saveFile(new File([data], filename, { type: "application/json" }));
}

async function confirmReset() {
    const ok = await confirm({
        title: "Reset Wrapped?",
        body: "All tracked statistics and the all-time counts will be deleted. Tracking starts over from today.",
        confirmText: "Reset",
        destructive: true,
        icon: UI.trash,
        iconColor: "red"
    });
    if (!ok) return;
    Promise.all([resetStats(), clearAllTime()])
        .then(() => showToast({ text: "Wrapped was reset", variant: "success" }))
        .catch(() => showToast({ text: "Reset failed", variant: "critical" }));
}

const TOGGLES = [
    { key: "trackMessages", label: "Messages", hint: "Messages you send (per server, channel, hour) and DMs you receive.", icon: ICONS.message, color: "blue" },
    { key: "trackVoice", label: "Voice time", hint: "Time in voice channels and calls, and who was there with you.", icon: ICONS.voice, color: "green" },
    { key: "trackActive", label: "Active time", hint: "Time Discord is focused and you are not idle.", icon: ICONS.clock, color: "orange" },
    { key: "trackGames", label: "Games", hint: "Time per game from your own activity status.", icon: ICONS.game, color: "pink" },
    { key: "showTitleBarButton", label: "Show icon in the title bar", hint: "Opens the dashboard. Also available in the Vencord toolbox.", icon: ICONS.chart, color: "purple" }
] as const;

function Panel() {
    const s = settings.use(["trackMessages", "trackVoice", "trackActive", "trackGames", "showTitleBarButton", "idleMinutes"]);
    const stats = useStats();
    const days = Object.keys(stats.days).length;

    return (
        <Sheet
            embedded
            header={{
                title: "Wrapped",
                subtitle: `Tracking since ${dateLong(stats.since)} · ${days} ${days === 1 ? "day" : "days"} with data · stored only on this device (last 366 days).`,
                icon: ICONS.chart,
                iconColor: "purple",
                actions: <Button icon={ICONS.chart} onClick={openWrappedModal}>Open dashboard</Button>
            }}
        >
            <Section title="Tracking">
                {TOGGLES.map(t => (
                    <ToggleRow key={t.key} icon={t.icon} color={t.color} title={t.label} subtitle={t.hint} checked={s[t.key]} onChange={v => settings.store[t.key] = v} />
                ))}
                <Row
                    leading={<Glyph path={ICONS.clock} color="gray" />}
                    title="Idle after"
                    subtitle="Minutes without mouse or keyboard input before active time stops counting."
                    trailing={<Select<number> value={s.idleMinutes} options={[2, 5, 10, 15, 30].map(m => ({ value: m, label: `${m} min` }))} onChange={v => settings.store.idleMinutes = v} />}
                />
            </Section>

            <Section title="Data">
                <Row
                    title="Export or reset"
                    trailing={
                        <div className={cl("buttons")}>
                            <Button small variant="gray" icon={UI.download} onClick={exportData}>Export JSON</Button>
                            <Button small variant="destructive" icon={UI.trash} onClick={confirmReset}>Reset all data</Button>
                        </div>
                    }
                />
            </Section>
        </Sheet>
    );
}

export const SettingsPanel = ErrorBoundary.wrap(Panel, { noop: true });

// ---------------------------------------------------------------- Title bar

function TitleBarButton() {
    const { showTitleBarButton } = settings.use(["showTitleBarButton"]);
    if (!showTitleBarButton) return null;

    return (
        <HeaderBarIcon
            className={cl("btn-titlebar")}
            onClick={openWrappedModal}
            tooltip="Wrapped"
            icon={() => <Icon path={ICONS.chart} size={20} className="vc-ui-tb-icon" />}
        />
    );
}

export function renderTitleBarButton() {
    return (
        <ErrorBoundary key="vc-wrapped-titlebar" noop>
            <TitleBarButton />
        </ErrorBoundary>
    );
}
