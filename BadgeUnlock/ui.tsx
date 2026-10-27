/*
 * BadgeUnlock – settings panel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ui.css";

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";

import { Button, Empty, Note, Section, Sheet, strokeIcon, ToggleRow } from "../_ui";
import { ALL_BADGES, BadgeDef, GROUPS, iconUrl, ORDER } from "./badges";
import { settings } from "./index";

const cl = classNameFactory("vc-badgeunlock-");

// Lucide shield-check
const BADGE_PATH = strokeIcon("M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z", "m9 12 2 2 4-4");
const HEADER = { title: "Badge Unlock", icon: BADGE_PATH, iconColor: "purple" } as const;

function setShown(ids: Iterable<string>) {
    settings.store.shown = [...new Set(ids)].sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
}

function BadgeIcon({ badge, size = 22 }: { badge: BadgeDef; size?: number; }) {
    return <img className={cl("icon")} src={iconUrl(badge.icon)} alt="" width={size} height={size} draggable={false} />;
}

function Preview({ shown }: { shown: string[]; }) {
    const badges = ALL_BADGES.filter(b => shown.includes(b.id));
    if (!badges.length) return <Empty icon={BADGE_PATH} title="No badges selected" hint="Turn on the badges you want below." />;

    return (
        <div className={cl("preview")}>
            {badges.map(b => (
                <span key={b.id} className={cl("preview-badge")} title={b.name}>
                    <BadgeIcon badge={b} size={24} />
                </span>
            ))}
        </div>
    );
}

export const SettingsPanel = ErrorBoundary.wrap(() => {
    const { shown, hideReal } = settings.use(["shown", "hideReal"]);
    const set = new Set(shown);

    const toggle = (id: string, on: boolean) => {
        const next = new Set(shown);
        if (on) next.add(id); else next.delete(id);
        setShown(next);
    };

    return (
        <Sheet embedded header={{ ...HEADER, subtitle: `${shown.length} of ${ALL_BADGES.length} badges shown` }}>
            <Note>Only you see these badges - nothing is sent to Discord, so friends still see your real profile. Reopen a profile to see changes.</Note>

            <Section
                title="Your profile"
                right={
                    <span className={cl("actions")}>
                        <Button variant="plain" small onClick={() => setShown(ALL_BADGES.map(b => b.id))}>Show all</Button>
                        <Button variant="plain" small disabled={!shown.length} onClick={() => setShown([])}>Hide all</Button>
                    </span>
                }
            >
                <Preview shown={shown} />
                <ToggleRow
                    icon={BADGE_PATH}
                    color="gray"
                    title="Hide my real badges"
                    subtitle="Only the badges selected here are shown"
                    checked={hideReal}
                    onChange={v => settings.store.hideReal = v}
                />
            </Section>

            {GROUPS.map(group => {
                const all = group.badges.every(b => set.has(b.id));
                return (
                    <Section
                        key={group.title}
                        title={group.title}
                        right={
                            <Button
                                variant="plain"
                                small
                                onClick={() => setShown(all
                                    ? shown.filter(id => !group.badges.some(b => b.id === id))
                                    : [...shown, ...group.badges.map(b => b.id)])}
                            >
                                {all ? "None" : "All"}
                            </Button>
                        }
                    >
                        {group.badges.map(b => (
                            <ToggleRow
                                key={b.id}
                                leading={<span className={cl("leading")}><BadgeIcon badge={b} /></span>}
                                title={b.name}
                                subtitle={b.description({ username: "you" })}
                                checked={set.has(b.id)}
                                onChange={v => toggle(b.id, v)}
                            />
                        ))}
                    </Section>
                );
            })}
        </Sheet>
    );
}, { noop: true });
