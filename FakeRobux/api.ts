/*
 * FakeRobux – Roblox data (real profiles, avatars, catalog). All read-only, public, no account needed.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import type { AvatarModel } from "./viewer3d";

type Helpers = PluginNative<typeof import("./native")>;

/** The main-process part only loads when Discord starts, a reload (Ctrl+R) isn't enough */
const Native: Helpers = {
    api: async (...args) => helpers().api(...args),
    image: async (...args) => helpers().image(...args),
    text: async (...args) => helpers().text(...args)
};

function helpers(): Helpers {
    const h = VencordNative.pluginHelpers.FakeRobux as Helpers | undefined;
    if (!h) throw new Error("Restart Discord completely (quit it from the tray icon, then open it again) - a reload with Ctrl+R isn't enough.");
    return h;
}

export interface RobloxUser {
    id: number;
    name: string;
    displayName: string;
    verified: boolean;
    created?: string;
    description?: string;
    banned?: boolean;
}

export interface Counts {
    friends: number | null;
    followers: number | null;
    following: number | null;
}

export interface RobloxBadge {
    id: number;
    name: string;
    imageUrl: string;
}

export interface CatalogItem {
    id: number;
    itemType: "Asset" | "Bundle";
    name: string;
    price: number;
    creatorName: string;
    creatorVerified: boolean;
}

const toUser = (u: any): RobloxUser => ({
    id: u.id,
    name: u.name,
    displayName: u.displayName || u.name,
    verified: !!u.hasVerifiedBadge,
    created: u.created,
    description: u.description,
    banned: u.isBanned
});

export const profileUrl = (id: number) => `https://www.roblox.com/users/${id}/profile`;
export const itemUrl = (item: Pick<CatalogItem, "id" | "itemType">) =>
    `https://www.roblox.com/${item.itemType === "Bundle" ? "bundles" : "catalog"}/${item.id}`;

// ---------------------------------------------------------------- Users

/** Exact username → user (null when nobody has that name) */
export async function lookupUser(username: string): Promise<RobloxUser | null> {
    const res = await Native.api("https://users.roblox.com/v1/usernames/users", { usernames: [username.trim()], excludeBannedUsers: false });
    const hit = res?.data?.[0];
    return hit ? getUser(hit.id) : null;
}

export async function getUser(id: number): Promise<RobloxUser> {
    return toUser(await Native.api(`https://users.roblox.com/v1/users/${id}`));
}

/** Similar names, for when the exact name doesn't exist */
export async function searchUsers(keyword: string): Promise<RobloxUser[]> {
    const res = await Native.api(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(keyword.trim())}&limit=10`);
    return (res?.data ?? []).map(toUser);
}

export async function getCounts(id: number): Promise<Counts> {
    const count = (what: string) => Native.api(`https://friends.roblox.com/v1/users/${id}/${what}/count`).then(r => r?.count ?? null, () => null);
    const [friends, followers, following] = await Promise.all([count("friends"), count("followers"), count("followings")]);
    return { friends, followers, following };
}

/** Roblox's own badges (Veteran, Friendship, Administrator …) */
export async function getRobloxBadges(id: number): Promise<RobloxBadge[]> {
    const res = await Native.api(`https://accountinformation.roblox.com/v1/users/${id}/roblox-badges`);
    return Array.isArray(res) ? res.filter(b => b?.imageUrl).map(b => ({ id: b.id, name: b.name, imageUrl: b.imageUrl })) : [];
}

// ---------------------------------------------------------------- Pictures

const images = new Map<string, Promise<string | null>>();

/** Picture from Roblox's CDN as data URL (cached) */
export function image(url: string | null | undefined): Promise<string | null> {
    if (!url) return Promise.resolve(null);
    let p = images.get(url);
    if (!p) {
        p = Native.image(url).catch(() => null);
        images.set(url, p);
        p.then(v => { if (!v) images.delete(url); });
    }
    return p;
}

const thumbUrls = new Map<string, Promise<string | null>>();

function thumbUrl(key: string, api: string): Promise<string | null> {
    let p = thumbUrls.get(key);
    if (!p) {
        p = Native.api(api).then(r => {
            const t = r?.data?.[0];
            return t?.state === "Completed" ? t.imageUrl as string : null;
        }, () => null);
        thumbUrls.set(key, p);
        p.then(v => { if (!v) thumbUrls.delete(key); });
    }
    return p;
}

export async function avatar(userId: number, kind: "headshot" | "body"): Promise<string | null> {
    const url = kind === "headshot"
        ? await thumbUrl(`h${userId}`, `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`)
        : await thumbUrl(`b${userId}`, `https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
    return image(url);
}

/** Thumbnails of several catalog items with one request per type; key = "Asset:123" / "Bundle:456" */
export async function itemThumbUrls(items: CatalogItem[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const assets = items.filter(i => i.itemType === "Asset").map(i => i.id);
    const bundles = items.filter(i => i.itemType === "Bundle").map(i => i.id);

    const load = async (type: CatalogItem["itemType"], ids: number[], api: string) => {
        if (!ids.length) return;
        try {
            const res = await Native.api(api + ids.join(","));
            for (const t of res?.data ?? []) if (t?.state === "Completed" && t.imageUrl) out.set(`${type}:${t.targetId}`, t.imageUrl);
        } catch { }
    };
    await Promise.all([
        load("Asset", assets, "https://thumbnails.roblox.com/v1/assets?size=150x150&format=Png&isCircular=false&assetIds="),
        load("Bundle", bundles, "https://thumbnails.roblox.com/v1/bundles/thumbnails?size=150x150&format=Png&isCircular=false&bundleIds=")
    ]);
    return out;
}

// ---------------------------------------------------------------- Catalog

/** Items that cost Robux; without a keyword Roblox's most favorited ones (Korblox, Headless …) */
export async function searchCatalog(keyword: string): Promise<CatalogItem[]> {
    const q = keyword.trim();
    const url = "https://catalog.roblox.com/v1/search/items/details?Limit=30&MinPrice=1&SalesTypeFilter=1"
        + (q ? `&Keyword=${encodeURIComponent(q)}` : "&Category=1&SortType=1");
    const res = await Native.api(url);
    return (res?.data ?? [])
        .filter((i: any) => typeof i?.price === "number" && i.price > 0 && (i.itemType === "Asset" || i.itemType === "Bundle"))
        .map((i: any): CatalogItem => ({
            id: i.id,
            itemType: i.itemType,
            name: String(i.name ?? "").trim(),
            price: i.price,
            creatorName: i.creatorName ?? "",
            creatorVerified: !!i.creatorHasVerifiedBadge
        }));
}

// ---------------------------------------------------------------- 3D avatar

/** Roblox spreads CDN files over t0–t7.rbxcdn.com by a hash of the file name */
export function cdnUrl(hash: string) {
    let i = 31;
    for (let t = 0; t < hash.length; t++) i ^= hash.charCodeAt(t);
    return `https://t${i % 8}.rbxcdn.com/${hash}`;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const models = new Map<number, Promise<AvatarModel>>();

/**
 * The avatar as a 3D model (OBJ + textures). /v1/users/avatar-3d wants a login, but the batch endpoint hands out
 * the same export publicly when asked for format "Obj". Roblox builds it on demand, so it can be "Pending" first.
 */
export function avatar3d(userId: number): Promise<AvatarModel> {
    let p = models.get(userId);
    if (!p) {
        p = loadAvatar3d(userId);
        models.set(userId, p);
        p.catch(() => models.delete(userId));
    }
    return p;
}

async function loadAvatar3d(userId: number): Promise<AvatarModel> {
    let manifestUrl: string | null = null;
    for (let i = 0; i < 12 && !manifestUrl; i++) {
        const r = await Native.api("https://thumbnails.roblox.com/v1/batch", [
            { requestId: `${userId}:3d`, targetId: userId, type: "Avatar", size: "420x420", format: "Obj" }
        ]);
        const t = r?.data?.[0];
        if (t?.state === "Completed" && t.imageUrl) manifestUrl = t.imageUrl;
        else if (t?.state === "Pending") await sleep(1500);
        else throw new Error(t?.errorMessage || `3D model ${t?.state ?? "unavailable"}`);
    }
    if (!manifestUrl) throw new Error("Roblox took too long to build the 3D model");

    const manifest = JSON.parse(await Native.text(manifestUrl));
    const [obj, mtl] = await Promise.all([Native.text(cdnUrl(manifest.obj)), Native.text(cdnUrl(manifest.mtl))]);
    const textures: Record<string, string> = {};
    await Promise.all([...new Set<string>(manifest.textures ?? [])].map(async hash => {
        const url = await image(cdnUrl(hash));
        if (url) textures[hash] = url;
    }));
    return { obj, mtl, textures, aabb: manifest.aabb };
}
