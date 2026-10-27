/*
 * UI playground – every part of the _ui kit in all its states, plus a few real plugin windows.
 * Edit ../_ui/ui.css or ../_ui/index.tsx and the page reloads instantly.
 */

import "./playground.css";

import { APP_GLYPHS } from "../../_ui/appGlyphs";

import { ModalRoot, ModalSize } from "@utils/modal";
import { type ReactNode, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import {
    AppArtwork, AppIcon, appArtwork, Avatar, Badge, Button, cl, confirm, Empty, Field, Glyph, Group, ICONS, IconButton, LinkRow, Note,
    notify, openAlert, openWindow, Pill, Pills, PluginArtwork, Popover, Progress, Row, RoundButton, SearchField, Section, Segmented, Select,
    Sheet, Slider, Spinner, State, Stats, TextArea, TextField, Toggle, ToggleRow
} from "../../_ui";

const AV = (n: number) => `https://cdn.discordapp.com/embed/avatars/${n % 6}.png`;

/** A window that is always open, inline in the page */
function Inline({ children, size = ModalSize.MEDIUM, wide }: { children: ReactNode; size?: ModalSize; wide?: boolean; }) {
    return (
        <div className={`pg-inline${wide ? " pg-wide" : ""}`}>
            <ModalRoot size={size} className={`${cl("window")} ${cl(`window-${size}`)}`}>{children}</ModalRoot>
        </div>
    );
}

// ---------------------------------------------------------------- Component sheets

function Controls() {
    const [on, setOn] = useState(true);
    const [seg, setSeg] = useState<"dms" | "req" | "log">("dms");
    const [vol, setVol] = useState(60);
    const [tags, setTags] = useState(["Friends", "Gaming", "School"]);
    const [pick, setPick] = useState("Friends");

    return (
        <Inline>
            <Sheet header={{ title: "Controls", subtitle: "Buttons, switches, tabs, pills, slider", icon: ICONS.gear }}>
                <Section title="Buttons">
                    <Row title="Filled" trailing={<><Button small>Small</Button><Button>Save</Button></>} />
                    <Row title="Gray / tinted / plain" trailing={<><Button variant="gray">Cancel</Button><Button variant="tinted">Tinted</Button><Button variant="plain">Plain</Button></>} />
                    <Row title="Destructive" trailing={<><Button variant="destructive" small icon={ICONS.trash}>Delete</Button><Button variant="destructive" icon={ICONS.leave}>Leave</Button></>} />
                    <Row title="With icon / disabled" trailing={<><Button icon={ICONS.download}>Download</Button><Button disabled>Disabled</Button></>} />
                    <Row title="Colored" trailing={<><Button color="green">Accept</Button><Button variant="tinted" color="orange">Snooze</Button></>} />
                    <Row title="Icon buttons" trailing={<>
                        <IconButton icon={ICONS.edit} label="Edit" onClick={() => { }} />
                        <IconButton icon={ICONS.copy} label="Copy" onClick={() => { }} active />
                        <IconButton icon={ICONS.trash} label="Delete" onClick={() => { }} destructive />
                        <RoundButton icon={ICONS.refresh} label="Refresh" onClick={() => { }} />
                    </>} />
                </Section>
                <Section title="Selection">
                    <Row title="Toggle" subtitle="Plain switch" trailing={<Toggle checked={on} onChange={setOn} />} />
                    <ToggleRow icon={ICONS.bell} color="red" title="Toggle row" subtitle="The whole row toggles" checked={on} onChange={setOn} />
                    <ToggleRow icon={ICONS.bell} title="Disabled" checked={false} onChange={() => { }} disabled />
                    <div style={{ padding: "10px 14px" }}>
                        <Segmented value={seg} onChange={setSeg} options={[{ value: "dms", label: "DMs" }, { value: "req", label: "Requests", count: 62 }, { value: "log", label: "Log" }]} />
                    </div>
                    <Row title="Slider" trailing={<Slider value={vol} onChange={setVol} format={v => `${v}%`} />} />
                </Section>
                <Section title="Pills">
                    <div style={{ padding: "12px 14px" }}>
                        <Pills>
                            {["All · 48", "Friends", "Active · 16", "Quiet · 11"].map(p => (
                                <Pill key={p} selected={pick === p} onClick={() => setPick(p)}>{p}</Pill>
                            ))}
                            {tags.map(t => <Pill key={t} icon={ICONS.folder} onRemove={() => setTags(tags.filter(x => x !== t))}>{t}</Pill>)}
                            <Pill leading={<Avatar src={AV(1)} size={20} />}>with avatar</Pill>
                        </Pills>
                    </div>
                </Section>
            </Sheet>
        </Inline>
    );
}

function Inputs() {
    const [q, setQ] = useState("");
    const [name, setName] = useState("VOID");
    const [text, setText] = useState("");
    const [sel, setSel] = useState("h264");
    return (
        <Inline>
            <Sheet header={{ title: "Inputs", subtitle: "Fields, search, select", icon: ICONS.edit, iconColor: "indigo" }}>
                <SearchField value={q} onChange={setQ} placeholder="Name, username or ID …" />
                <Field label="Display name" hint="Shown in your profile card.">
                    <TextField value={name} onChange={setName} placeholder="Name" />
                </Field>
                <Field label="Codec">
                    <Select value={sel} onChange={setSel} options={[{ value: "h264", label: "H.264" }, { value: "av1", label: "AV1" }, { value: "vp9", label: "VP9" }]} />
                </Field>
                <Field label="Notes">
                    <TextArea value={text} onChange={setText} placeholder="Anything …" />
                </Field>
                <Section title="Field in a group">
                    <Field label="Interval" hint="Seconds between two requests."><TextField value="1" onChange={() => { }} /></Field>
                </Section>
            </Sheet>
        </Inline>
    );
}

function Feedback() {
    return (
        <Inline>
            <Sheet header={{ title: "Feedback", subtitle: "Badges, states, notes, progress", icon: ICONS.info, iconColor: "teal", live: true }}>
                <Stats items={[{ value: "48", label: "Open DMs" }, { value: "12.99", label: "EUR" }, { value: "3", label: "Failed", color: "red" }]} />
                <Section title="Badges">
                    <Row title="Tones" trailing={<><Badge>Default</Badge><Badge color="blue">New</Badge><Badge color="green">Active</Badge><Badge color="orange">Beta</Badge><Badge color="red" solid>3</Badge></>} />
                    <Row title="State" trailing={<State tone="ok" check>Synced</State>} />
                    <Row title="Busy" trailing={<State spinner>Loading</State>} />
                    <Row title="Warn / bad" trailing={<><State tone="warn">Rate limited</State><State tone="bad">Failed</State></>} />
                    <Row title="Progress" trailing={<Spinner />}><Progress value={64} /></Row>
                </Section>
                <Note>Groups, PinDMs pins and protected DMs are excluded. Throttled to ~1/s.</Note>
                <Note tone="warn">Discord limits this to one request per second.</Note>
                <Note tone="bad">You are about to <b>leave</b> 3 groups. This can't be undone.</Note>
                <Note tone="ok">Included in your account.</Note>
                <Group><Empty icon={ICONS.search} title="No DMs match this filter." hint="Try another search or clear the filters.">
                    <Button variant="gray" small>Clear filters</Button>
                </Empty></Group>
            </Sheet>
        </Inline>
    );
}

function Lists() {
    const [sel, setSel] = useState<Set<number>>(new Set([1]));
    const names = ["hamodie", "benzgodxdpl", "herbie", "Xzlvae", "AlphaCloud"];
    return (
        <Inline>
            <Sheet header={{ title: "Lists", subtitle: "Sections, rows, glyphs", icon: ICONS.folder, iconColor: "orange" }}>
                <Section title="Settings" footer="Rows with a glyph, chevron and trailing values.">
                    <Row leading={<Glyph path={ICONS.user} />} title="Profile" chevron onClick={() => { }} />
                    <Row leading={<Glyph path={ICONS.bell} color="red" />} title="Notifications" trailing="On" chevron onClick={() => { }} />
                    <Row leading={<Glyph path={ICONS.download} color="green" />} title="Downloads" subtitle={<><span>3 files</span><span>12 MB</span></>} chevron onClick={() => { }} />
                    <LinkRow icon={ICONS.plus} onClick={() => { }}>Add rule …</LinkRow>
                    <LinkRow icon={ICONS.trash} destructive onClick={() => { }}>Reset all</LinkRow>
                </Section>
                <Section title="Dormant" right={names.length}>
                    {names.map((n, i) => (
                        <Row
                            key={n}
                            onClick={() => setSel(s => { const x = new Set(s); x.has(i) ? x.delete(i) : x.add(i); return x; })}
                            className={sel.has(i) ? cl("selected") : undefined}
                            leading={<Avatar src={AV(i)} size={32} />}
                            title={n}
                            subtitle={`${33 + i * 2} days ago`}
                            trailing={<><Button small variant="gray" icon={ICONS.external}>Open</Button><IconButton icon={ICONS.close} label="Close DM" onClick={() => { }} destructive /></>}
                        />
                    ))}
                </Section>
            </Sheet>
        </Inline>
    );
}

/** Window states: notice above the buttons, paused plugin, multi-line rows, small segments, square avatars */
function WindowStates() {
    const [seg, setSeg] = useState<"day" | "week" | "all">("week");
    const [on, setOn] = useState(false);
    return (
        <Inline>
            <Sheet
                header={{ app: "AutoQuest", title: "AutoQuest", subtitle: "Paused - header picture greyed out", actions: <RoundButton icon={ICONS.refresh} label="Refresh" onClick={() => { }} /> }}
                paused
                onClose={() => { }}
                top={<Segmented small value={seg} onChange={setSeg} options={[{ value: "day", label: "Today" }, { value: "week", label: "This week", count: 4 }, { value: "all", label: "All" }]} />}
                notice="Save is disabled: the interval must be at least 1 second."
                actions={[{ label: "Cancel", onClick() { } }, { label: "Save", disabled: true, onClick() { } }]}
            >
                <Section title="Multi-line rows" footer="Rows with align=&quot;top&quot; keep picture and trailing content at the top.">
                    <Row
                        align="top"
                        leading={<Avatar src={AV(4)} size={36} square />}
                        title="Play Marvel Rivals for 15 minutes"
                        subtitle={<><span>700 Orbs</span><span>ends in 3 days</span></>}
                        note="Enrolled automatically. Discord needs the game running, AutoQuest fakes it in the background."
                        trailing={<Badge color="green" icon={ICONS.check}>Claimable</Badge>}
                    />
                    <Row align="top" leading={<Avatar size={36} square />} title="No picture (fallback)" subtitle="Square avatar without src" note="Second line of explanation." trailing={<Toggle checked={on} onChange={setOn} />} />
                </Section>
                <Section title="Clickable badges">
                    <Row title="Badge with onClick" trailing={<><Badge color="blue" onClick={() => { }}>Filter</Badge><Badge icon={ICONS.close} onClick={() => { }}>Remove</Badge></>} />
                    <Row title="Spinner sizes" trailing={<><Spinner size={12} /><Spinner /><Spinner size={20} /></>} />
                </Section>
            </Sheet>
        </Inline>
    );
}

/** Plugin app icons (duotone line icons) with and without the busy dot, and the fallback */
function Artwork() {
    return (
        <Inline>
            <Sheet header={{ title: "App artwork", subtitle: `${Object.keys(APP_GLYPHS).length} plugin icons`, iconNode: <AppArtwork src={appArtwork("PluginHub")!} size={36} /> }}>
                <Section title="All plugins">
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: "16px 6px", padding: 16 }}>
                        {Object.keys(APP_GLYPHS).map(n => (
                            <div key={n} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "var(--vc-ui-dim)", fontSize: 11 }}>
                                <AppArtwork src={appArtwork(n)!} size={42} />
                                {n}
                            </div>
                        ))}
                    </div>
                </Section>
                <Section title="Small (rows, Plugin Hub)">
                    <div style={{ display: "flex", gap: 12, padding: 14, flexWrap: "wrap" }}>
                        {Object.keys(APP_GLYPHS).map(n => <AppArtwork key={n} src={appArtwork(n)!} size={24} />)}
                    </div>
                </Section>
                <Section title="Busy" footer="pulse = the plugin is working (following, listening, room open …)">
                    <div style={{ display: "flex", gap: 14, padding: 14, alignItems: "center" }}>
                        <AppArtwork src={appArtwork("SongRadar")!} size={42} pulse />
                        <AppArtwork src={appArtwork("CallClips")!} size={42} pulse />
                    </div>
                </Section>
                <Section title="Fallback" footer="A plugin without artwork shows its own fallback (here an AppIcon).">
                    <div style={{ display: "flex", gap: 14, padding: 14, alignItems: "center" }}>
                        <PluginArtwork app="NoSuchPlugin" fallback={<AppIcon path={ICONS.folder} size={42} />} />
                    </div>
                </Section>
            </Sheet>
        </Inline>
    );
}

/** Popover (floating card) – plain content and with a whole Sheet inside */
function Popovers() {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Popover width={320}>
                <Row leading={<Avatar src={AV(2)} size={40} />} title="herbie" subtitle="Online · Playing Valorant" />
                <SearchField value="" onChange={() => { }} placeholder="Message @herbie" />
                <Pills><Pill>Friend</Pill><Pill>2 mutual servers</Pill></Pills>
            </Popover>
            <Popover width={320}>
                <Sheet header={{ title: "Popover with Sheet", subtitle: "Spacing adapts", icon: ICONS.bell }} actions={[{ label: "Dismiss", onClick() { } }]}>
                    <Note>A whole Sheet inside a Popover uses the popover's spacing.</Note>
                </Sheet>
            </Popover>
        </div>
    );
}

/** Sheet embedded in a page (Vencord settings panel): no window, no own scroll */
function Embedded() {
    const [a, setA] = useState(true);
    return (
        <div style={{ padding: 20, border: "1px dashed #2b2d33", borderRadius: 12 }}>
            <Sheet embedded header={{ app: "SilentMode", title: "SilentMode", subtitle: "Embedded in the Vencord settings page" }}>
                <Section title="General">
                    <ToggleRow icon={ICONS.bell} title="Silent typing" subtitle="Nobody sees you typing" checked={a} onChange={setA} />
                    <Row title="Interval" trailing={<Select value={1} onChange={() => { }} width={120} options={[{ value: 1, label: "1 s" }, { value: 5, label: "5 s" }]} />} />
                </Section>
            </Sheet>
        </div>
    );
}

/** The floating bar shown while the title bar icons are being arranged (titlebar.tsx) */
function ArrangeBar() {
    return (
        <div style={{ position: "relative", height: 70, border: "1px dashed #2b2d33", borderRadius: 12 }}>
            <div className={cl("tb-arrange")} style={{ position: "absolute", top: 14 }}>
                <span className={cl("tb-arrange-text")}>Drag the icons to arrange them</span>
                <Button small variant="gray">Cancel</Button>
                <Button small>Save position</Button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- Real windows

function homeOrganizer(close: () => void) {
    return (
        <Sheet
            header={{ app: "HomeOrganizer", title: "HomeOrganizer", subtitle: "Clean up DMs and review friend requests", icon: ICONS.folder }}
            onClose={close}
            top={<Segmented value="dms" onChange={() => { }} options={[{ value: "dms", label: "DMs" }, { value: "req", label: "Requests", count: 62 }]} />}
        >
            <Stats items={[{ value: 5, label: "Dormant" }, { value: 0, label: "Without messages" }, { value: 10, label: "Protected", color: "green" }]} />
            <SearchField value="" onChange={() => { }} placeholder="Name, username or ID …" />
            <Section title="Groups" right={16}>
                {["braveraven_3725_, Vali, listeningtonora", "!? NAITY, BAHR.", "hey leute, Nubzi, Vali, H2O"].map((n, i) => (
                    <Row key={n} leading={<Avatar src={AV(i + 2)} size={36} />} title={n} subtitle={`${3 + i * 2} members`}
                        trailing={<><span>{15 + i * 8} days ago</span><Button small variant="gray" icon={ICONS.external}>Open</Button><Button small variant="destructive" icon={ICONS.leave}>Leave</Button></>} />
                ))}
            </Section>
        </Sheet>
    );
}

function confirmList(close: () => void, count = 50) {
    const names = Array.from({ length: count }, (_, i) => `user_${i + 1}`);
    return (
        <Sheet
            header={{ title: `Close ${count} DMs?`, icon: ICONS.warning, iconColor: "red" }}
            onClose={close}
            actions={[{ label: "Cancel", onClick: close }, { label: `Close ${count}`, variant: "destructive", onClick: close }]}
        >
            <div>The selected DMs - the history is kept; the DMs only disappear from your list.</div>
            <Section>{names.map((n, i) => <Row key={n} leading={<Avatar src={AV(i)} size={24} />} title={n} trailing={`${30 + i} days ago`} />)}</Section>
        </Sheet>
    );
}

function App() {
    return (
        <div className="pg">
            <div className="pg-head">
                <AppIcon path={ICONS.gear} size={32} />
                <h1>UI Playground</h1>
                <Button variant="gray" onClick={() => openWindow(homeOrganizer, { size: "large" })}>Window</Button>
                <Button variant="gray" onClick={() => openWindow(confirmList, { size: "small" })}>Long confirm</Button>
                <Button variant="gray" onClick={() => confirm({ title: "Delete 3 clips?", body: "This can't be undone.", confirmText: "Delete", destructive: true, icon: ICONS.trash })}>Alert</Button>
                <Button variant="gray" onClick={() => openAlert({ title: "Update ready", body: "Restart Discord to apply VoidCord 1.4.", icon: ICONS.download, buttons: [{ label: "Later" }, { label: "Changelog" }, { label: "Restart" }] })}>3 buttons</Button>
                <Button onClick={() => {
                    notify({ title: "Quest completed", body: "Claimed 700 orbs from \"Play Marvel Rivals\".", kind: "success", app: "AutoQuest" });
                    setTimeout(() => notify({ title: "Rate limited", body: "Waiting 12 s before the next request.", kind: "attention", app: "HomeOrganizer" }), 300);
                    setTimeout(() => notify({ title: "Song found", body: "Daft Punk – Something About Us", image: AV(3), app: "SongRadar", onClick: () => { } }), 600);
                    setTimeout(() => notify({ title: "Reward claimed", body: "Quest \"Play Fortnite\" finished.", kind: "success", app: "AutoQuest", side: <Badge color="green" icon={ICONS.check}>+700 Orbs</Badge> }), 900);
                    setTimeout(() => notify({ title: "Upload failed", body: "Gofile did not answer. Try again in a minute.", kind: "error", app: "GofileUpload" }), 1200);
                }}>Notifications</Button>
            </div>
            <Controls />
            <Inputs />
            <Feedback />
            <Lists />
            <WindowStates />
            <Artwork />
            <Popovers />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <Embedded />
                <ArrangeBar />
            </div>
            <Inline size={ModalSize.SMALL}>{confirmList(() => { }, 4)}</Inline>
            <Inline size={ModalSize.LARGE} wide>{homeOrganizer(() => { })}</Inline>
        </div>
    );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
