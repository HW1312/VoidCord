/*
 * PluginHub – list, title bar button & window (built from the shared _ui kit)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { hasAnyVisibleSettings, pluginRequiresRestart } from "@api/PluginManager";
import { useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { openPluginModal } from "@components/settings";
import { Plugin } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { useMemo, useState } from "@webpack/common";

import { AppArtwork, appArtwork, Badge, Button, Empty, Icon, IconButton, ICONS, Note, openWindow, Row, SearchField, Section, Segmented, Sheet, strokeIcon, Toggle, ToggleRow } from "../_ui";
import logo from "file://logo.png?base64";
import { getOwnPlugins, isEnabled, isNew, isTesting, markTried, needsRestart, setEnabled, settings } from "./index";
import { hubThemes, ThemesTab } from "./themes";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

// VoidCord emblem, embedded into the build
const LOGO_SRC = `data:image/png;base64,${logo}`;
// Lucide layout-grid
const GRID_PATH = strokeIcon(
    "M4 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
    "M15 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
    "M15 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z",
    "M4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z"
);

// ---------------------------------------------------------------- List

/** The plugin's app icon artwork (website/icons-src), or nothing for plugins that don't have one yet */
function PluginIcon({ plugin, size }: { plugin: Plugin; size: number; }) {
    const src = appArtwork(plugin.name);
    return src ? <AppArtwork src={src} size={size} /> : null;
}

function PluginRow({ plugin }: { plugin: Plugin; }) {
    const enabled = isEnabled(plugin);

    return (
        <Row
            leading={appArtwork(plugin.name) && <PluginIcon plugin={plugin} size={36} />}
            title={
                <span className="vc-pluginhub-name">
                    {plugin.name}
                    {isNew(plugin) && <Badge color="blue" solid>New</Badge>}
                    {isTesting(plugin) && <Badge color="orange" title="Not proven to work yet – tell us if it does">Testing</Badge>}
                    {needsRestart(plugin) && <Badge color="orange">Restart required</Badge>}
                </span>
            }
            subtitle={plugin.description}
            trailing={
                <>
                    {enabled
                        ? hasAnyVisibleSettings(plugin) && (
                            <IconButton icon={ICONS.gear} label="Settings" onClick={() => { markTried(plugin); openPluginModal(plugin); }} />
                        )
                        : <IconButton icon={ICONS.info} label="What does this do?" onClick={() => openInfoModal(plugin)} />}
                    <Toggle checked={enabled} onChange={v => setEnabled(plugin, v)} label={plugin.name} />
                </>
            }
        />
    );
}

// ---------------------------------------------------------------- Info

/** The plugin's own short explanation (`about` in its definition), or its description if it has none */
const getAbout = (p: Plugin) => (p as Plugin & { about?: string; }).about ?? p.description;

function InfoContent({ plugin }: { plugin: Plugin; }) {
    const notes = [
        isTesting(plugin) && "Not proven to work yet - tell us if it does.",
        pluginRequiresRestart(plugin) && "Turning it on takes effect after a restart."
    ].filter(Boolean) as string[];

    return (
        <>
            <p className="vc-pluginhub-info-desc">{getAbout(plugin)}</p>
            {notes.map(n => <Note key={n}>{n}</Note>)}
        </>
    );
}

export function openInfoModal(plugin: Plugin) {
    openWindow(close => (
        <Sheet
            header={{ app: plugin.name, title: plugin.name, subtitle: "Plugin", icon: GRID_PATH, iconColor: "indigo" }}
            onClose={close}
            actions={[
                { label: "Close", onClick: close },
                { label: "Turn on", onClick: () => { setEnabled(plugin, true); close(); } }
            ]}
        >
            <InfoContent plugin={plugin} />
        </Sheet>
    ), { size: "small" });
}

// ---------------------------------------------------------------- Hub

function Hub({ embedded, onClose }: { embedded?: boolean; onClose?(): void; }) {
    useSettings(["plugins.*"] as any);
    const { sort, tab, showTitleBarButton } = settings.use(["sort", "tab", "showTitleBarButton"]);
    const [query, setQuery] = useState("");

    const all = useMemo(getOwnPlugins, [sort]);
    const q = query.trim().toLowerCase();
    const shown = q
        ? all.filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
        : all;

    const onCount = all.filter(isEnabled).length;
    const restartCount = all.filter(needsRestart).length;
    const themes = tab === "themes";

    const top = (
        <div className="vc-pluginhub-top">
            <Segmented
                value={tab}
                options={[
                    { value: "plugins", label: "Plugins", count: all.length },
                    { value: "themes", label: "Themes", count: hubThemes.length }
                ]}
                onChange={v => settings.store.tab = v}
            />
            <div className="vc-pluginhub-toolbar">
                <SearchField value={query} onChange={setQuery} placeholder={themes ? "Search themes…" : "Search plugins…"} />
                {!themes && (
                    <>
                        <Button variant="gray" small title="Change sort order" onClick={() => settings.store.sort = sort === "new" ? "az" : "new"}>
                            {sort === "new" ? "Newest first" : "A–Z"}
                        </Button>
                        <span className="vc-pluginhub-count">{onCount} of {all.length} on</span>
                    </>
                )}
            </div>
        </div>
    );

    return (
        <Sheet
            embedded={embedded}
            header={{ title: "Plugin Hub", subtitle: "Your plugins & themes", iconNode: <img src={LOGO_SRC} className="vc-pluginhub-logo" alt="" /> }}
            onClose={onClose}
            top={top}
        >
            {themes ? <ThemesTab query={query} /> : (
                <>
                    {restartCount > 0 && (
                        <Note tone="warn">
                            <span className="vc-pluginhub-restart">
                                <span>{restartCount === 1 ? "1 change takes" : `${restartCount} changes take`} effect after a restart.</span>
                                <Button small onClick={() => location.reload()}>Restart now</Button>
                            </span>
                        </Note>
                    )}

                    <Section
                        right={
                            <span className="vc-pluginhub-bulk">
                                <Button variant="plain" small onClick={() => shown.forEach(p => setEnabled(p, true))}>{q ? "Matches on" : "All on"}</Button>
                                <Button variant="plain" small onClick={() => shown.forEach(p => setEnabled(p, false))}>{q ? "Matches off" : "All off"}</Button>
                            </span>
                        }
                        plain={!shown.length}
                    >
                        {shown.length
                            ? shown.map(p => <PluginRow key={p.name} plugin={p} />)
                            : <Empty icon={ICONS.search} title="No plugins found." />}
                    </Section>
                </>
            )}

            {embedded && (
                <Section title="Options">
                    <ToggleRow
                        icon={GRID_PATH}
                        color="indigo"
                        title="Show icon in the title bar"
                        checked={showTitleBarButton}
                        onChange={v => settings.store.showTitleBarButton = v}
                    />
                </Section>
            )}
        </Sheet>
    );
}

// ---------------------------------------------------------------- Settings & window

export const SettingsPanel = ErrorBoundary.wrap(() => <Hub embedded />, { noop: true });

export function openHubModal() {
    openWindow(close => <Hub onClose={close} />, { size: "large" });
}

// ---------------------------------------------------------------- Title bar

function TitleBarButton() {
    const { showTitleBarButton } = settings.use(["showTitleBarButton"]);
    if (!showTitleBarButton) return null;

    return (
        <HeaderBarIcon
            className="vc-pluginhub-tb"
            onClick={openHubModal}
            tooltip="Plugins & Themes"
            icon={() => <img src={LOGO_SRC} className="vc-ui-tb-icon vc-pluginhub-tb-logo" alt="" />}
        />
    );
}

export function renderTitleBarButton() {
    return (
        <ErrorBoundary key="vc-pluginhub-titlebar" noop>
            <TitleBarButton />
        </ErrorBoundary>
    );
}
