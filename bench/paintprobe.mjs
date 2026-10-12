#!/usr/bin/env node
// Finds what keeps the idle renderer busy outside JS: frame rate while idle, style/layout counts,
// and which DOM nodes get repainted (from a short devtools.timeline trace).
//
//   node bench/paintprobe.mjs [--stock]
import { CDP, waitForMainTarget } from "./lib/cdp.mjs";
import { findInstall, installStub, killDiscord, launchDiscord, relaunchNormally, removeStub, sleep } from "./lib/discord.mjs";

const PORT = 9229;
const stock = process.argv.includes("--stock");
const log = msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
const inst = findInstall("stable");

try {
    await killDiscord(inst);
    if (stock) installStub(inst);
    launchDiscord(inst, { variant: stock ? "stock" : "mod", port: PORT });
    const cdp = await CDP.connect((await waitForMainTarget(PORT, 120000)).webSocketDebuggerUrl);
    await cdp.eval(`new Promise(res => (function t() { document.querySelector('[data-list-id="guildsnav"]') ? res() : setTimeout(t, 100); })())`, 130000);
    log(`${stock ? "stock" : "vencord"} ready, settling 40 s`);
    await sleep(40000);

    // frames produced while idle
    const fps = await cdp.eval(`new Promise(res => { let n = 0; const t0 = performance.now();
        (function f() { n++; performance.now() - t0 < 5000 ? requestAnimationFrame(f) : res(n / 5); })(); })`, 20000);

    await cdp.send("Performance.enable");
    const m0 = await cdp.metrics();
    await sleep(10000);
    const m1 = await cdp.metrics();
    const d = k => +(m1[k] - m0[k]).toFixed(3);

    // trace 5 s and count paints per node
    const events = [];
    cdp.on("Tracing.dataCollected", p => events.push(...p.value));
    const done = new Promise(r => cdp.on("Tracing.tracingComplete", r));
    await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline", transferMode: "ReportEvents" });
    await sleep(5000);
    await cdp.send("Tracing.end");
    await done;

    const count = name => events.filter(e => e.name === name && e.ph !== "E").length;
    const paints = new Map();
    for (const e of events) {
        if (e.name !== "Paint") continue;
        const id = e.args?.data?.nodeId;
        if (id) paints.set(id, (paints.get(id) ?? 0) + 1);
    }
    await cdp.send("DOM.getDocument", { depth: 0 });
    const top = [...paints].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const described = [];
    for (const [backendNodeId, n] of top) {
        const desc = await cdp.send("DOM.describeNode", { backendNodeId }).then(r => r.node, () => null);
        const attrs = desc?.attributes ?? [];
        const cls = attrs[attrs.indexOf("class") + 1] ?? "";
        described.push(`${n}× <${desc?.localName ?? "?"}${cls ? " class=\"" + cls.slice(0, 90) + "\"" : ""}>`);
    }

    const media = await cdp.eval(`({
        videosPlaying: [...document.querySelectorAll("video")].filter(v => !v.paused).length,
        canvases: document.querySelectorAll("canvas").length,
        iframes: [...document.querySelectorAll("iframe")].map(f => f.src.slice(0, 80)),
        animatedImgs: [...document.querySelectorAll("img")].filter(i => /\\.gif|animated=true|\\.apng/.test(i.src) && i.getBoundingClientRect().width > 0).length,
        animations: document.getAnimations().filter(a => a.playState === "running").length,
    })`);

    console.log(JSON.stringify({
        variant: stock ? "stock" : "vencord",
        idleFps: fps,
        per10s: {
            taskMs: Math.round(d("TaskDuration") * 1000), scriptMs: Math.round(d("ScriptDuration") * 1000),
            layoutMs: Math.round(d("LayoutDuration") * 1000), styleMs: Math.round(d("RecalcStyleDuration") * 1000),
            layouts: d("LayoutCount"), styleRecalcs: d("RecalcStyleCount"),
        },
        per5sTrace: { frames: count("BeginFrame"), paints: count("Paint"), composites: count("CompositeLayers"), updateLayerTree: count("UpdateLayerTree"), timers: count("TimerFire"), rafs: count("FireAnimationFrame") },
        topPaintedNodes: described,
        media,
    }, null, 2));
    cdp.close();
} finally {
    await killDiscord(inst).catch(() => { });
    if (stock) removeStub(inst);
    relaunchNormally(inst);
}
