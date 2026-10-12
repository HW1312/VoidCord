/*
 * FakeRobux – "Send" tab: find a real Roblox user, then simulate a donation or a gift from the catalog
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

import { Button, Empty, Field, IconButton, ICONS, Note, Pill, Pills, Row, SearchField, Section, Spinner, TextField } from "../_ui";
import { CatalogItem, getUser, itemThumbUrls, lookupUser, RobloxUser, searchCatalog, searchUsers } from "./api";
import { GIFT_PATH, ItemThumb, PERSON_PATH, Robux, SEND_PATH, Tabs, useAsync, UserAvatar, UserName } from "./components";
import { addRecent, removeRecent, settings } from "./index";
import { Profile } from "./profile";
import { openPurchase } from "./purchase";

const PRESETS = [10, 50, 100, 500, 1_000, 5_000, 10_000, 100_000];
const MAX_MESSAGE = 120;

const errorText = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

// ---------------------------------------------------------------- Search

/** Last opened users under the search field, each with its own remove button (like Roblox / YouTube) */
function RecentSearches({ onPick }: { onPick(id: number): void; }) {
    const { recentSearches } = settings.use(["recentSearches"]);
    if (!recentSearches.length) return null;

    return (
        <Section title="Recent">
            {recentSearches.map(r => (
                <Row
                    key={r.id}
                    leading={<UserAvatar userId={r.id} size={32} />}
                    title={<UserName displayName={r.displayName} name={r.name} verified={r.verified} />}
                    trailing={<IconButton icon={ICONS.close} label="Remove from history" onClick={() => removeRecent(r.id)} />}
                    onClick={() => onPick(r.id)}
                />
            ))}
        </Section>
    );
}

function FindUser({ onPick }: { onPick(id: number): void; }) {
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [similar, setSimilar] = useState<RobloxUser[] | null>(null);

    const find = async () => {
        const name = query.trim();
        if (!name || busy) return;
        setBusy(true);
        setError(null);
        setSimilar(null);
        try {
            const exact = await lookupUser(name);
            if (exact) return onPick(exact.id);
            const list = await searchUsers(name).catch(() => []);
            if (list.length) setSimilar(list);
            else setError(`No Roblox user called “${name}”.`);
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Section title="Recipient" footer="Enter a Roblox username - their real profile is loaded from Roblox.">
                <Row
                    title={
                        <SearchField
                            value={query}
                            onChange={setQuery}
                            placeholder="Roblox username"
                            onKeyDown={e => { if (e.key === "Enter") find(); }}
                            autoFocus
                        />
                    }
                    trailing={<Button small onClick={find} disabled={!query.trim() || busy}>{busy ? <Spinner /> : "Find"}</Button>}
                />
            </Section>
            {error && <Note tone="bad">{error}</Note>}
            {!similar && <RecentSearches onPick={onPick} />}
            {similar && (
                <Section title="Did you mean">
                    {similar.map(u => (
                        <Row
                            key={u.id}
                            leading={<UserAvatar userId={u.id} size={32} />}
                            title={<UserName displayName={u.displayName} name={u.name} verified={u.verified} />}
                            onClick={() => onPick(u.id)}
                            chevron
                        />
                    ))}
                </Section>
            )}
        </>
    );
}

// ---------------------------------------------------------------- Donate

function Donate({ user }: { user: RobloxUser; }) {
    const { balance } = settings.use(["balance"]);
    const [amount, setAmount] = useState("100");
    const [message, setMessage] = useState("");
    const value = Math.floor(Number(amount.replace(/[^\d]/g, "")) || 0);

    return (
        <>
            <Section title="Amount" right={<span className="vc-fakerobux-dim">Balance <Robux value={balance} size={12} /></span>}>
                <Row title={
                    <Pills>
                        {PRESETS.map(p => (
                            <Pill key={p} selected={value === p} onClick={() => setAmount(String(p))}><Robux value={p} size={12} /></Pill>
                        ))}
                    </Pills>
                } />
                <Row title={
                    <Field label="Custom amount">
                        <TextField value={amount} inputMode="numeric" onChange={v => setAmount(v.replace(/[^\d]/g, "").slice(0, 12))} />
                    </Field>
                } />
                <Row title={
                    <Field label="Message (optional)" hint={`${message.length}/${MAX_MESSAGE}`}>
                        <TextField value={message} placeholder={`Thanks ${user.displayName}!`} onChange={v => setMessage(v.slice(0, MAX_MESSAGE))} />
                    </Field>
                } />
            </Section>
            {value > balance && <Note tone="warn">That's more than your balance of {balance.toLocaleString("en-US")} Robux.</Note>}
            <Button wide icon={SEND_PATH} disabled={value <= 0 || value > balance} onClick={() => openPurchase({ recipient: user, amount: value, message: message.trim() })}>
                Continue
            </Button>
        </>
    );
}

// ---------------------------------------------------------------- Gift

function Gift({ user }: { user: RobloxUser; }) {
    const { balance } = settings.use(["balance"]);
    const [query, setQuery] = useState("");
    const [search, setSearch] = useState("");
    const items = useAsync(() => searchCatalog(search), [search]);
    const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());

    useEffect(() => {
        if (!items.value?.length) return;
        let alive = true;
        itemThumbUrls(items.value).then(m => alive && setThumbs(m));
        return () => { alive = false; };
    }, [items.value]);

    return (
        <Section
            plain
            title="Catalog"
            right={<span className="vc-fakerobux-dim">Balance <Robux value={balance} size={12} /></span>}
        >
            <SearchField
                value={query}
                onChange={setQuery}
                placeholder="Search the Roblox catalog, then Enter"
                onKeyDown={e => { if (e.key === "Enter") setSearch(query); }}
            />
            {items.loading && !items.value && <Empty title="Loading catalog…"><Spinner /></Empty>}
            {items.error && <Note tone="bad">{items.error}</Note>}
            {items.value && !items.value.length && <Empty icon={ICONS.search} title="Nothing found" hint="Only items that cost Robux are shown." />}
            {!!items.value?.length && (
                <div className="vc-fakerobux-grid">
                    {items.value.map(item => {
                        const url = thumbs.get(`${item.itemType}:${item.id}`);
                        const tooExpensive = item.price > balance;
                        return (
                            <button
                                key={`${item.itemType}:${item.id}`}
                                type="button"
                                className="vc-fakerobux-card"
                                disabled={tooExpensive}
                                title={tooExpensive ? "Not enough Robux" : `Gift ${item.name} to ${user.displayName}`}
                                onClick={() => openPurchase({ recipient: user, amount: item.price, item, thumbUrl: url })}
                            >
                                <ItemThumb url={url} size={96} item={item as CatalogItem} />
                                <span className="vc-fakerobux-card-name">{item.name}</span>
                                <span className="vc-fakerobux-card-creator">By {item.creatorName}</span>
                                <Robux value={item.price} size={12} className="vc-fakerobux-card-price" />
                            </button>
                        );
                    })}
                </div>
            )}
        </Section>
    );
}

// ---------------------------------------------------------------- Tab

type Mode = "robux" | "item";

/** "Gift" inside someone's profile: choose Robux or a catalog item */
function GiftPanel({ user }: { user: RobloxUser; }) {
    const [mode, setMode] = useState<Mode>("robux");

    return (
        <>
            <div className="vc-fakerobux-gift-head">
                <UserAvatar userId={user.id} size={40} />
                <span className="vc-fakerobux-gift-title"><span>Gift to <b>{user.displayName}</b></span><span className="vc-fakerobux-handle">@{user.name}</span></span>
            </div>
            <Tabs<Mode>
                value={mode}
                options={[{ value: "robux", label: "Robux" }, { value: "item", label: "Item" }]}
                onChange={setMode}
            />
            {mode === "robux" ? <Donate user={user} /> : <Gift user={user} />}
        </>
    );
}

export function SendView() {
    const [userId, setUserId] = useState<number | null>(null);
    const [gifting, setGifting] = useState(false);
    const user = useAsync(async () => userId ? getUser(userId) : null, [userId]);

    // Remember everyone that was opened, newest first
    useEffect(() => { if (user.value) addRecent(user.value); }, [user.value]);

    const open = (id: number) => {
        setGifting(false);
        setUserId(id);
    };

    if (!userId) {
        return (
            <>
                <FindUser onPick={open} />
                <Empty icon={PERSON_PATH} title="Send Robux or gift an item" hint="Everything here is a simulation: nothing is sent and nobody gets anything - only your fake balance changes." />
            </>
        );
    }

    const u = user.value?.id === userId ? user.value : null;

    return (
        <>
            <div className="vc-fakerobux-back">
                <Button small variant="plain" icon={ICONS.back} onClick={() => gifting ? setGifting(false) : setUserId(null)}>
                    {gifting && u ? u.displayName : "Search"}
                </Button>
            </div>
            {user.error && <Note tone="bad">{user.error}</Note>}
            {!u && !user.error && <Empty title="Loading profile…"><Spinner /></Empty>}
            {u && u.banned && <Note tone="warn">This account is banned on Roblox.</Note>}
            {u && (gifting
                ? <GiftPanel user={u} />
                : <Profile user={u} actions={<Button small icon={GIFT_PATH} onClick={() => setGifting(true)}>Gift</Button>} />)}
        </>
    );
}
