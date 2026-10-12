#!/usr/bin/env node
// Where do extra DOM nodes and CSS rules come from? Counts nodes per region, nodes inside
// Vencord-made elements (vc-*), and CSS rules per stylesheet, on the first bench channel.
//
//   node bench/domprobe.mjs [--stock]
import { readFileSync } from "fs";
import { join } from "path";

import { loadConfig } from "./lib/config.mjs";
import { CDP, waitForMainTarget } from "./lib/cdp.mjs";
import { findInstall, installStub, killDiscord, launchDiscord, relaunchNormally, removeStub, sleep } from "./lib/discord.mjs";

const PORT = 9229;
const stock = process.argv.includes("--stock");
const cfg = loadConfig();
const inst = findInstall("stable");

try {
    await killDiscord(inst);
    if (stock) installStub(inst);
    launchDiscord(inst, { variant: stock ? "stock" : "mod", port: PORT });
    const cdp = await CDP.connect((await waitForMainTarget(PORT, 120000)).webSocketDebuggerUrl);
    await cdp.eval(`new Promise(res => (function t() { document.querySelector('[data-list-id="guildsnav"]') ? res() : setTimeout(t, 100); })())`, 130000);
    await cdp.eval(`(() => { history.pushState(history.state, "", ${JSON.stringify(cfg.channels[0])}); dispatchEvent(new PopStateEvent("popstate", { state: history.state })); })()`);
    await sleep(20000);

    const r = await cdp.eval(`(() => {
        const count = el => el ? el.getElementsByTagName("*").length + 1 : 0;
        const q = s => document.querySelector(s);
        const regions = {
            total: count(document.documentElement),
            head: count(document.head),
            guildList: count(q('[data-list-id="guildsnav"]')),
            channelSidebar: count(q('[class*="sidebar_"]')),
            messages: count(q('[data-list-id="chat-messages"]')),
            chatInput: count(q('form[class*="form_"]')),
            membersOrProfile: count(q('[class*="profilePanel"], [class*="membersWrap"], aside')),
            titleBar: count(q('[class*="titleBar"], [class*="bar_"]')),
            layers: count(q('[class*="layerContainer"]')),
            svgElements: document.querySelectorAll("svg *").length,
        };
        // elements created by Vencord / our plugins usually carry vc- classes or data-vc attributes
        const vc = {};
        for (const el of document.querySelectorAll('[class*="vc-"], [id^="vc-"], [data-vc]')) {
            if (el.parentElement?.closest('[class*="vc-"], [id^="vc-"], [data-vc]')) continue; // outermost only
            const name = ([...el.classList].find(c => c.startsWith("vc-")) ?? el.id ?? "data-vc").replace(/-[a-z0-9]{0,4}$/, "");
            vc[name] = (vc[name] ?? 0) + count(el);
        }
        const sheets = [...document.styleSheets].map(s => {
            let n = 0;
            try { n = s.cssRules.length; } catch {}
            const o = s.ownerNode;
            return [(o?.id || o?.getAttribute?.("data-vc-style") || (s.href ? s.href.replace(/^.*\\//, "") : o?.tagName?.toLowerCase())) ?? "?", n];
        }).sort((a, b) => b[1] - a[1]);
        return {
            regions,
            vcNodes: Object.entries(vc).sort((a, b) => b[1] - a[1]).slice(0, 20),
            cssRules: sheets.reduce((s, [, n]) => s + n, 0),
            styleSheets: sheets.length,
            topSheets: sheets.slice(0, 15),
        };
    })()`);
    console.log(stock ? "STOCK" : "VENCORD", JSON.stringify(r, null, 1));
    cdp.close();
} finally {
    await killDiscord(inst).catch(() => { });
    if (stock) removeStub(inst);
    relaunchNormally(inst);
}
