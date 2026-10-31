/*
 * LinkCards – cards under messages & settings
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { updateMessage } from "@api/MessageUpdater";
import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { Link } from "@components/Link";
import { openImageModal } from "@utils/discord";
import { classes } from "@utils/misc";
import { useForceUpdater, useIntersection } from "@utils/react";
import { showToast, useEffect, useState } from "@webpack/common";

import { Button, Icon as KitIcon, IconButton, ICONS as UI_ICONS, LinkRow, Progress, Row, Section, Sheet, State, TextField, ToggleRow } from "../_ui";
import { clearCache, getEntry, isFresh, isLoading, isSettled, load, subscribe } from "./cache";
import { ICONS } from "./icons";
import { settings } from "./index";
import { getGitHubRate, onGitHubRate, refreshGitHubRate, resetBackoffs } from "./net";
import { findMatches, Match, matchUrl, PROVIDERS } from "./providers";
import { CardView, IconDef, Provider, ProviderId, timeAgo, truncate } from "./types";

const cl = classNameFactory("vc-linkcards-");

const PROVIDER_IDS: ProviderId[] = PROVIDERS.map(p => p.id);

// ---------------------------------------------------------------- Building blocks

/** Kit icon (thin Lucide strokes); a custom viewBox still draws a filled shape */
function Icon({ icon, size = 16, className }: { icon: IconDef; size?: number; className?: string; }) {
    if (!icon.viewBox) return <KitIcon path={icon.path} size={size} className={classes(cl("icon"), className)} />;
    return (
        <svg viewBox={icon.viewBox} width={size} height={size} className={classes(cl("icon"), className)} aria-hidden>
            <path fill="currentColor" fillRule="evenodd" d={icon.path} />
        </svg>
    );
}

// ---------------------------------------------------------------- Discord's own embed

/** Discord's embed for this card's link – its media and texts go into the card */
function findEmbed(message: any, key: string): any {
    return message.embeds?.find((e: any) => e?.url && matchUrl(e.url)?.key === key);
}

const hasInvite = (message: any, key: string) =>
    message.codedLinks?.some((l: any) => l?.code && matchUrl(`https://discord.gg/${l.code}`)?.key === key);

/** Message + link pairs that were already re-rendered to drop Discord's embed */
const rerendered = new Set<string>();

function takeOverEmbed(message: any, key: string) {
    const id = `${message.id}:${key}`;
    if (!settings.store.replaceEmbeds || rerendered.has(id)) return;
    if (!findEmbed(message, key) && !hasInvite(message, key)) return;
    if (rerendered.size > 1000) rerendered.clear();
    rerendered.add(id);
    updateMessage(message.channel_id, message.id);
}

/** Card from the embed alone, when the live request failed before it ever had data */
function viewFromEmbed(embed: any, provider: Provider): CardView {
    return {
        color: embed.color || "var(--vc-ui-gray)",
        provider: embed.provider?.name || provider.label,
        title: embed.rawTitle || embed.author?.name || embed.url,
        url: embed.url,
        meta: [embed.rawTitle && embed.author?.name],
        description: truncate(embed.rawDescription)
    };
}

function goneView(provider: Provider, url: string, last: CardView | null): CardView {
    const gone = provider.gone ?? { title: "No longer available", description: "This link was deleted, made private or has expired." };
    return {
        color: "var(--vc-ui-red)",
        provider: last?.provider ?? provider.label,
        context: last?.context,
        icon: ICONS.warning,
        title: gone.title,
        url: last?.url ?? url,
        description: gone.description,
        meta: [last && `Last seen as “${last.title}”`]
    };
}

// ---------------------------------------------------------------- Media

/** Players Discord itself embeds – other video URLs are web pages, not players */
const PLAYER_HOSTS = /^https:\/\/(www\.youtube(-nocookie)?\.com\/embed\/|www\.tiktok\.com\/(embed|player)\/|player\.twitch\.tv\/|clips\.twitch\.tv\/embed|player\.vimeo\.com\/|open\.spotify\.com\/embed|w\.soundcloud\.com\/player|streamable\.com\/[eo]\/|www\.dailymotion\.com\/embed\/)/;

const MAX_W = 400;
const MAX_H = 450;
/** Narrower pictures are shown small beside the text */
const SMALL_THUMB = 300;

function fit(w?: number, h?: number) {
    if (!w || !h) return { width: MAX_W, height: Math.round(MAX_W * 9 / 16) };
    const scale = Math.min(MAX_W / w, MAX_H / h);
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

const mediaSrc = (m: any): string | undefined => m?.proxyURL || m?.url;
const sizeStyle = ({ width, height }: { width: number; height: number; }) => ({ width, aspectRatio: `${width} / ${height}` });

function withAutoplay(url: string) {
    const u = new URL(url);
    u.searchParams.set("autoplay", "1");
    return u.href;
}

function EmbedMedia({ embed }: { embed: any; }) {
    const [playing, setPlaying] = useState(false);
    const { video, thumbnail } = embed;
    const image = embed.image ?? embed.images?.[0];
    const poster = mediaSrc(thumbnail) ?? mediaSrc(image);

    // Video files proxied by Discord play directly
    if (video?.proxyURL) return (
        <video
            className={cl("media")}
            style={sizeStyle(fit(video.width, video.height))}
            src={video.proxyURL}
            poster={poster}
            controls
            preload="metadata"
        />
    );

    // Players (YouTube, TikTok, Twitch …): preview first, iframe on click – like Discord
    if (video?.url && PLAYER_HOSTS.test(video.url)) {
        const style = sizeStyle(fit(video.width ?? thumbnail?.width, video.height ?? thumbnail?.height));
        if (playing) return (
            <iframe
                className={cl("media")}
                style={style}
                src={withAutoplay(video.url)}
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                referrerPolicy="strict-origin-when-cross-origin"
                sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts"
                allowFullScreen
            />
        );
        return (
            <button className={classes(cl("media"), cl("player"))} style={style} onClick={() => setPlaying(true)} aria-label="Play">
                {poster && <img src={poster} alt="" />}
                <span className={cl("play")}><span className={cl("play-scrim")}><KitIcon path={UI_ICONS.play} size={22} /></span></span>
            </button>
        );
    }

    const picture = image ?? thumbnail;
    if (!mediaSrc(picture) || (!image && (picture.width ?? 0) < SMALL_THUMB)) return null;

    return (
        <img
            className={classes(cl("media"), cl("image"))}
            style={sizeStyle(fit(picture.width, picture.height))}
            src={mediaSrc(picture)}
            alt=""
            onClick={() => openImageModal({ url: mediaSrc(picture)!, original: picture.url, width: picture.width, height: picture.height })}
        />
    );
}

/** Thumbnail beside the text when it is too small to be the main picture */
function sideThumbnail(embed: any): string | undefined {
    const t = embed?.thumbnail;
    if (!t || embed.video || embed.image || embed.images?.length || (t.width ?? 0) >= SMALL_THUMB) return undefined;
    return mediaSrc(t);
}

// ---------------------------------------------------------------- Card

function RefreshButton({ loading, onClick }: { loading: boolean; onClick(): void; }) {
    return (
        <span className={classes("vc-linkcards-refresh", loading && "vc-linkcards-spin")}>
            <IconButton icon={UI_ICONS.refresh} label="Refresh now" disabled={loading} onClick={onClick} />
        </span>
    );
}

function CardBody({ view, thumbnail, media }: { view: CardView; thumbnail?: string; media?: React.ReactNode; }) {
    const meta = view.meta?.filter(Boolean) as string[] | undefined;

    const text = (
        <>
            <div className={cl("title-row")}>
                {view.avatar
                    ? <img className={cl("avatar")} src={view.avatar} alt="" />
                    : view.icon && <Icon icon={view.icon} className={cl("state-icon")} />}
                <Link href={view.url} className={cl("title")} title={view.title}>{view.title}</Link>
                {view.titleSuffix && <span className={cl("suffix")}>{view.titleSuffix}</span>}
                {view.badge && <span className={cl("badge")}>{view.badge}</span>}
            </div>

            {view.price && (
                <div className={cl("price")}>
                    {view.price.discount != null && <span className={cl("discount")}>-{view.price.discount}%</span>}
                    {view.price.initial && <s className={cl("initial")}>{view.price.initial}</s>}
                    <span className={cl("final")}>{view.price.final}</span>
                </div>
            )}

            {view.description && <div className={cl("description")}>{view.description}</div>}
            {!!meta?.length && <div className={cl("meta")}>{meta.join(" · ")}</div>}

            {!!view.labels?.length && (
                <div className={cl("labels")}>
                    {view.labels.map(l => (
                        <span key={l.name} className={cl("label")} style={{ "--vc-linkcards-label": l.color } as React.CSSProperties}>
                            {l.name}
                        </span>
                    ))}
                </div>
            )}

            {!!view.stats?.length && (
                <div className={cl("stats")}>
                    {view.stats.map((s, i) => (
                        <span key={i} className={cl("stat")} title={s.title}>
                            {s.icon && <Icon icon={s.icon} size={14} />}
                            {s.dot && <span className={cl("dot")} style={{ background: s.dot }} />}
                            {s.value}
                        </span>
                    ))}
                </div>
            )}
        </>
    );

    return (
        <>
            {thumbnail
                ? <div className={cl("with-thumb")}><div className={cl("text")}>{text}</div><img className={cl("thumb")} src={thumbnail} alt="" /></div>
                : text}
            {media}
            {view.action && (
                <div className={cl("action")}>
                    <Button small color="green" onClick={view.action.onClick}>{view.action.label}</Button>
                </div>
            )}
        </>
    );
}

function LinkCard({ match, active, message }: { match: Match; active: boolean; message: any; }) {
    const { provider, target, key } = match;
    const forceUpdate = useForceUpdater();

    useEffect(() => subscribe(key, forceUpdate), [key]);

    // Keep "X min ago" up to date; expired data is reloaded in the process
    useEffect(() => {
        const id = setInterval(forceUpdate, 30_000);
        return () => clearInterval(id);
    }, []);

    const entry = getEntry(key);
    const loading = isLoading(key);

    useEffect(() => {
        if (active && !loading && !isFresh(provider, entry)) load(provider, target);
    });

    const settled = isSettled(key);
    useEffect(() => {
        if (settled) takeOverEmbed(message, key);
    }, [settled, key]);

    const refresh = () => {
        load(provider, target, true);
    };

    let live: CardView | null = null;
    if (entry?.data != null) {
        try {
            live = provider.render(entry.data, target);
        } catch {
            live = null;
        }
    }

    // Discord's embed only feeds the card while the card replaces it
    const embed = settings.store.replaceEmbeds ? findEmbed(message, key) : null;
    const gone = !!entry?.notFound;
    const fromEmbed = !gone && !live && !!entry?.error && !!embed;
    const view = gone ? goneView(provider, target.url, live) : live ?? (fromEmbed ? viewFromEmbed(embed, provider) : null);

    // No data yet: placeholder or error
    if (!view) {
        const failed = !!entry?.error && !loading;
        return (
            <div className={classes(cl("card"), cl("compact"), !failed && cl("pending"))}>
                <div className={cl("header")}>
                    <span className={cl("provider")}>{provider.label}</span>
                    <span className={cl("status")}>
                        {failed
                            ? <><Icon icon={ICONS.warning} size={12} className={cl("warn-icon")} />{entry!.error}</>
                            : "Loading…"}
                    </span>
                    {failed && !entry!.backoffUntil && <RefreshButton loading={loading} onClick={refresh} />}
                </div>
                {!failed && <div className={cl("skeleton")} />}
            </div>
        );
    }

    let status: string;
    if (loading) status = "Refreshing…";
    else if (gone) status = `Checked ${timeAgo(entry!.errorAt)}`;
    else if (fromEmbed) status = "Live data unavailable";
    else status = `Live · updated ${timeAgo(entry!.fetchedAt)}`;

    const stale = !gone && !!entry?.error;

    return (
        <div className={classes(cl("card"), gone && cl("gone"))} style={{ "--vc-linkcards-color": view.color } as React.CSSProperties}>
            {view.cover && <img className={cl("cover")} src={view.cover} alt="" />}
            <div className={cl("header")}>
                <span className={cl("provider")}>
                    {view.provider}
                    {view.context && <span className={cl("context")}> · {view.context}</span>}
                </span>
                {!provider.static && <>
                    <span className={cl("status")} title={entry?.fetchedAt ? `Last data: ${new Date(entry.fetchedAt).toLocaleString("en-US")}` : undefined}>
                        <span className={classes(cl("live-dot"), stale && cl("live-dot-stale"), gone && cl("live-dot-gone"))} />
                        {status}
                    </span>
                    {!entry?.backoffUntil && <RefreshButton loading={loading} onClick={refresh} />}
                </>}
            </div>
            <CardBody
                view={view}
                thumbnail={gone ? undefined : view.avatar ? undefined : sideThumbnail(embed)}
                media={embed && !gone && <EmbedMedia embed={embed} />}
            />
            {stale && live && !loading && (
                <div className={cl("stale")}>
                    <Icon icon={ICONS.warning} size={12} />
                    Refresh failed: {entry!.error}
                </div>
            )}
        </div>
    );
}

function Accessory({ message }: { message: any; }) {
    // Re-render when provider toggles or country change
    const { onlyVisible } = settings.use(["onlyVisible", "replaceEmbeds", "steamCountry", ...PROVIDER_IDS]);
    const [ref, visible] = useIntersection();

    const matches = findMatches(message.content);
    if (!matches.length) return null;

    return (
        <div ref={ref} className={cl("container")}>
            {matches.map(m => <LinkCard key={m.key} match={m} message={message} active={!onlyVisible || visible} />)}
        </div>
    );
}

export const LinkCardsAccessory = ErrorBoundary.wrap(Accessory, { noop: true });

// ---------------------------------------------------------------- Settings

const LINK_PATH = ICONS.link.path;

function RateLimitInfo() {
    const forceUpdate = useForceUpdater();
    const [checking, setChecking] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const { githubToken } = settings.use(["githubToken"]);

    useEffect(() => onGitHubRate(forceUpdate), []);

    const check = async () => {
        setChecking(true);
        try {
            const res = await refreshGitHubRate();
            setProblem(res.status === 401 ? "Invalid token" : res.status === 200 ? null : res.error ?? `HTTP ${res.status}`);
        } catch {
            setProblem("Check failed");
        } finally {
            setChecking(false);
        }
    };

    // After a token change, wait briefly until the setting has reached the main process
    useEffect(() => {
        const id = setTimeout(check, 1200);
        return () => clearTimeout(id);
    }, [githubToken]);

    const rate = getGitHubRate();
    const pct = rate ? Math.max(0, Math.min(100, rate.remaining / rate.limit * 100)) : 0;

    return (
        <Row
            title="Rate limit"
            subtitle={
                (rate && rate.reset > Date.now()
                    ? `Resets ${timeAgo(rate.reset)} (${new Date(rate.reset).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}). `
                    : "") + "Without a token 60 requests/hr, with a token 5000."
            }
            trailing={
                <>
                    {problem
                        ? <State tone="bad">{problem}</State>
                        : <State>{rate ? `${rate.remaining} / ${rate.limit} left` : "–"}</State>}
                    <RefreshButton loading={checking} onClick={check} />
                </>
            }
        >
            <Progress value={pct} color={pct < 15 ? "red" : "green"} />
        </Row>
    );
}

function TokenInput() {
    const { githubToken } = settings.use(["githubToken"]);
    const [show, setShow] = useState(false);

    return (
        <div className="vc-linkcards-input-row">
            <TextField
                type={show ? "text" : "password"}
                placeholder="ghp_… or github_pat_… (optional)"
                autoComplete="off"
                spellCheck={false}
                value={githubToken}
                onChange={v => settings.store.githubToken = v.trim()}
            />
            <IconButton icon={show ? ICONS.eyeOff.path : ICONS.eye.path} label={show ? "Hide" : "Show"} onClick={() => setShow(v => !v)} />
        </div>
    );
}

function CountryInput() {
    const { steamCountry } = settings.use(["steamCountry"]);
    const [value, setValue] = useState(steamCountry);
    const valid = /^[A-Z]{2}$/.test(value);

    return (
        <TextField
            className={classes("vc-linkcards-country", !valid && "vc-linkcards-country-bad")}
            maxLength={2}
            value={value}
            spellCheck={false}
            onChange={raw => {
                const v = raw.toUpperCase().replace(/[^A-Z]/g, "");
                setValue(v);
                if (/^[A-Z]{2}$/.test(v)) settings.store.steamCountry = v;
            }}
        />
    );
}

export const SettingsPanel = ErrorBoundary.wrap(() => {
    const store = settings.use(["onlyVisible", "replaceEmbeds", ...PROVIDER_IDS]);

    const clear = async () => {
        await clearCache();
        resetBackoffs();
        showToast({ text: "LinkCards cache cleared", variant: "success" });
    };

    return (
        <Sheet embedded header={{ title: "LinkCards", subtitle: "Live status cards under messages", icon: LINK_PATH, iconColor: "teal" }}>
            <Section title="Services">
                {PROVIDERS.map(p => (
                    <ToggleRow
                        key={p.id}
                        title={p.label}
                        subtitle={p.static ? p.hint : `${p.hint} · Cache ${Math.round(p.ttl / 60_000)} min`}
                        checked={store[p.id]}
                        onChange={v => settings.store[p.id] = v}
                    />
                ))}
            </Section>

            <Section
                title="GitHub token"
                footer="Optional, raises the rate limit. A token with no permissions (public data only) is enough. It is only sent to api.github.com."
            >
                <Row title={<TokenInput />} />
                <RateLimitInfo />
            </Section>

            <Section title="Steam">
                <Row title="Country for prices" subtitle="Two-letter country code, e.g. US, GB, DE, CA" trailing={<CountryInput />} />
            </Section>

            <Section title="Behavior">
                <ToggleRow
                    icon={ICONS.eye.path}
                    color="teal"
                    title="Only load visible cards"
                    subtitle="Only make requests once the message is on screen"
                    checked={store.onlyVisible}
                    onChange={v => settings.store.onlyVisible = v}
                />
                <ToggleRow
                    icon={LINK_PATH}
                    color="gray"
                    title="Replace Discord embed"
                    subtitle="The card takes over Discord's embed incl. video and pictures, and the invite card. Off: card shows below them"
                    checked={store.replaceEmbeds}
                    onChange={v => settings.store.replaceEmbeds = v}
                />
                <LinkRow icon={UI_ICONS.trash} destructive onClick={clear}>Clear cache</LinkRow>
            </Section>
        </Sheet>
    );
}, { noop: true });
