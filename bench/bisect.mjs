#!/usr/bin/env node
// Finds which Vencord plugins cost CSS rules, DOM nodes and JS heap.
// Each enabled plugin group is started ALONE (everything else off) and compared with "all off";
// groups above the thresholds are split further until single plugins remain.
//
//   node bench/bisect.mjs --yes [--groups 8]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { loadConfig } from "./lib/config.mjs";
import { CDP, waitForMainTarget } from "./lib/cdp.mjs";
import { findInstall, killDiscord, launchDiscord, relaunchNormally, sleep } from "./lib/discord.mjs";

const HERE = import.meta.dirname;
const PORT = 9229;
const argv = process.argv.slice(2);
const GROUPS = argv.includes("--groups") ? Number(argv[argv.indexOf("--groups") + 1]) : 8;
const SETTLE_MS = 15000;
// a plugin set counts as "costly" above any of these
const LIMITS = { cssRules: 500, domNodes: 200, jsHeapMB: 3 };

const cfg = loadConfig();
const inst = findInstall(cfg.branch);
const settingsPath = join(process.env.APPDATA, cfg.branch === "stable" ? "Vencord" : `Vencord-${cfg.branch}`, "settings", "settings.json");
const backup = readFileSync(settingsPath, "utf8");
const original = JSON.parse(backup);
const enabled = Object.entries(original.plugins).filter(([, p]) => p?.enabled).map(([n]) => n).sort();

const log = msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

if (!argv.includes("--yes")) {
    console.log(`Restarts Discord many times with plugin subsets (${enabled.length} enabled plugins). Run with --yes.`);
    process.exit(0);
}

function applyOnly(names) {
    const s = JSON.parse(backup);
    const on = new Set(names);
    for (const n of enabled) s.plugins[n] = { ...s.plugins[n], enabled: on.has(n) };
    writeFileSync(settingsPath, JSON.stringify(s, null, 4));
}

let runs = 0;
async function measure(names) {
    runs++;
    applyOnly(names);
    await killDiscord(inst);
    const t0 = launchDiscord(inst, { variant: "mod", port: PORT });
    const cdp = await CDP.connect((await waitForMainTarget(PORT, 120000)).webSocketDebuggerUrl);
    try {
        const readyAt = await cdp.eval(`new Promise(res => (function t() { document.querySelector('[data-list-id="guildsnav"]') ? res(performance.timeOrigin + performance.now()) : setTimeout(t, 50); })())`, 130000);
        await cdp.eval(`(() => { const p = ${JSON.stringify(cfg.channels[0])}; if (location.pathname !== p) { history.pushState(history.state, "", p); dispatchEvent(new PopStateEvent("popstate", { state: history.state })); } })()`);
        await sleep(SETTLE_MS);
        await cdp.send("HeapProfiler.collectGarbage");
        await sleep(1500);
        await cdp.send("Performance.enable");
        const m = await cdp.metrics();
        const css = await cdp.eval(`[...document.styleSheets].reduce((s, x) => { try { return s + x.cssRules.length; } catch { return s; } }, 0)`);
        return { cssRules: css, domNodes: m.Nodes, jsHeapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), readyMs: Math.round(readyAt - t0) };
    } finally {
        cdp.close();
    }
}

const delta = (r, base) => ({
    cssRules: r.cssRules - base.cssRules,
    domNodes: r.domNodes - base.domNodes,
    jsHeapMB: +(r.jsHeapMB - base.jsHeapMB).toFixed(1),
    readyMs: r.readyMs - base.readyMs,
});
const costly = d => d.cssRules >= LIMITS.cssRules || d.domNodes >= LIMITS.domNodes || d.jsHeapMB >= LIMITS.jsHeapMB;
const fmt = d => `css ${String(d.cssRules).padStart(6)}  dom ${String(d.domNodes).padStart(5)}  heap ${String(d.jsHeapMB).padStart(5)} MB  start ${String(d.readyMs).padStart(5)} ms`;

const out = { started: new Date().toISOString(), enabled: enabled.length, limits: LIMITS, tested: [], culprits: [] };
const dir = join(HERE, "results");
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const file = join(dir, `bisect-${out.started.replace(/[:.]/g, "-").slice(0, 19)}.json`);
const save = () => writeFileSync(file, JSON.stringify(out, null, 2));

let cleaned = false;
async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    writeFileSync(settingsPath, backup);
    await killDiscord(inst).catch(() => { });
    relaunchNormally(inst);
    log("Settings restored, Discord restarted normally.");
}
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });

async function explore(names, base, depth) {
    const r = await measure(names);
    const d = delta(r, base);
    const label = names.length === 1 ? names[0] : `${names.length} plugins (${names[0]} … ${names.at(-1)})`;
    log(`${"  ".repeat(depth)}${costly(d) ? "!" : " "} ${fmt(d)}  ${label}`);
    out.tested.push({ names, ...d });
    save();
    if (!costly(d)) return;
    if (names.length === 1) {
        out.culprits.push({ name: names[0], ...d });
        return;
    }
    const mid = Math.ceil(names.length / 2);
    await explore(names.slice(0, mid), base, depth + 1);
    await explore(names.slice(mid), base, depth + 1);
}

try {
    log(`${enabled.length} enabled plugins, ${GROUPS} groups. Measuring all off / all on.`);
    const base = await measure([]);
    const all = await measure(enabled);
    out.base = base;
    out.allOn = delta(all, base);
    log(`all off: css ${base.cssRules}, dom ${base.domNodes}, heap ${base.jsHeapMB} MB, start ${base.readyMs} ms`);
    log(`all on vs off: ${fmt(out.allOn)}`);
    save();

    const size = Math.ceil(enabled.length / GROUPS);
    for (let i = 0; i < enabled.length; i += size) await explore(enabled.slice(i, i + size), base, 0);

    out.culprits.sort((a, b) => b.cssRules - a.cssRules || b.jsHeapMB - a.jsHeapMB);
    save();
    log(`done after ${runs} starts`);
    console.log("\nCostly plugins (alone vs all off):");
    for (const c of out.culprits) console.log(`  ${fmt(c)}  ${c.name}`);
    console.log(`\nResult: ${file}`);
} finally {
    await cleanup();
}
