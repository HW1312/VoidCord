#!/usr/bin/env node
// CPU profile of the renderer main thread while scrolling the first bench channel:
// time per script (Discord vs Vencord) and the hottest functions with code snippets.
//
//   node bench/scrollprofile.mjs [--stock]
import { readFileSync } from "fs";
import { join } from "path";

import { loadConfig } from "./lib/config.mjs";
import { CDP, waitForMainTarget } from "./lib/cdp.mjs";
import { findInstall, installStub, killDiscord, launchDiscord, relaunchNormally, removeStub, sleep } from "./lib/discord.mjs";

const PORT = 9229;
const stock = process.argv.includes("--stock");
const cfg = loadConfig();
const channel = cfg.channels[0];
const inst = findInstall("stable");

try {
    await killDiscord(inst);
    if (stock) installStub(inst);
    launchDiscord(inst, { variant: stock ? "stock" : "mod", port: PORT });
    const cdp = await CDP.connect((await waitForMainTarget(PORT, 120000)).webSocketDebuggerUrl);
    await cdp.eval(`new Promise(res => (function t() { document.querySelector('[data-list-id="guildsnav"]') ? res() : setTimeout(t, 100); })())`, 130000);
    await cdp.eval(`(() => { history.pushState(history.state, "", ${JSON.stringify(channel)}); dispatchEvent(new PopStateEvent("popstate", { state: history.state })); })()`);
    await sleep(20000);

    const rect = await cdp.eval(`(() => {
        let el = document.querySelector('[data-list-id="chat-messages"]');
        while (el && el !== document.body) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) break;
            el = el.parentElement;
        }
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    const gesture = yDistance => cdp.send("Input.synthesizeScrollGesture", { ...rect, yDistance, speed: 1500, gestureSourceType: "mouse" }, 30000);
    await gesture(2000); await sleep(1500); await gesture(-2000); await sleep(1000);

    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.eval(`(() => { const f = window.__f = []; let l = performance.now(); (function r(t) { if (window.__f !== f) return; f.push(t - l); l = t; requestAnimationFrame(r); })(l); })()`);
    await cdp.send("Profiler.start");
    for (let i = 0; i < 2; i++) { await gesture(1500); await gesture(-1500); }
    const { profile } = await cdp.send("Profiler.stop", {}, 60000);
    const frames = (await cdp.eval("(() => { const f = window.__f.slice(1); window.__f = null; return f; })()")).sort((a, b) => a - b);

    const dt = new Map();
    profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000));
    const byUrl = new Map(), byFn = new Map();
    let total = 0;
    for (const n of profile.nodes) {
        const ms = dt.get(n.id) ?? 0;
        total += ms;
        const c = n.callFrame;
        const url = c.functionName.startsWith("(") ? c.functionName : (c.url.replace(/^.*\//, "") || "(native/inline)");
        byUrl.set(url, (byUrl.get(url) ?? 0) + ms);
        if (!c.functionName.startsWith("(")) {
            const k = `${c.functionName || "(anonymous)"}|${c.scriptId}|${c.lineNumber}|${c.columnNumber}|${url}`;
            byFn.set(k, (byFn.get(k) ?? 0) + ms);
        }
    }

    await cdp.send("Debugger.enable");
    const src = new Map();
    const snippet = async (id, line, col) => {
        if (!src.has(id)) src.set(id, await cdp.send("Debugger.getScriptSource", { scriptId: id }).then(r => r.scriptSource.split("\n"), () => null));
        return (src.get(id)?.[line] ?? "").slice(Math.max(0, col - 30), col + 170).replace(/\s+/g, " ");
    };

    console.log(`${stock ? "STOCK" : "VENCORD"}: ${frames.length} frames, p50 ${frames[frames.length >> 1]?.toFixed(1)} ms, p95 ${frames[Math.floor(frames.length * 0.95)]?.toFixed(1)} ms, profile ${Math.round(total)} ms`);
    console.log("Time per script:");
    for (const [u, ms] of [...byUrl].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${ms.toFixed(0).padStart(6)} ms  ${u}`);
    console.log("Hottest functions (self):");
    for (const [k, ms] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
        const [name, id, line, col, url] = k.split("|");
        console.log(`  ${ms.toFixed(1).padStart(6)} ms  ${name} (${url}:${+line + 1})\n             ${await snippet(id, +line, +col)}`);
    }
    cdp.close();
} finally {
    await killDiscord(inst).catch(() => { });
    if (stock) removeStub(inst);
    relaunchNormally(inst);
}
