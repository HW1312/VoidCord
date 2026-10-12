#!/usr/bin/env node
// Finds where idle CPU goes in the current (modded) Discord: CPU per process type,
// a renderer CPU profile with code snippets of the hottest functions, and running CSS animations.
//
//   node bench/diagnose.mjs [--seconds 60] [--settle 45]
import { execFileSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";

import { CDP, waitForMainTarget } from "./lib/cdp.mjs";
import { findInstall, killDiscord, launchDiscord, relaunchNormally, sleep } from "./lib/discord.mjs";

const argv = process.argv.slice(2);
const opt = (name, def) => {
    const i = argv.indexOf(name);
    return i >= 0 ? Number(argv[i + 1]) : def;
};
const SECONDS = opt("--seconds", 60);
const SETTLE = opt("--settle", 45);
const PORT = 9229;
const log = msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

const inst = findInstall("stable");

function processSnapshot() {
    const cmd = `Get-CimInstance Win32_Process -Filter "Name='${inst.exe}'" | ForEach-Object {
        '{0}\t{1}\t{2}\t{3}' -f $_.ProcessId, ([long]$_.UserModeTime + [long]$_.KernelModeTime), $_.PrivatePageCount, $_.CommandLine }`;
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8", windowsHide: true });
    return new Map(out.split(/\r?\n/).filter(Boolean).map(line => {
        const [pid, cpu100ns, priv, ...rest] = line.split("\t");
        const cl = rest.join("\t");
        const type = cl.match(/--type=([\w-]+)/)?.[1] ?? "main";
        const sub = cl.match(/--utility-sub-type=([\w.]+)/)?.[1];
        return [Number(pid), { type: sub ? `${type} (${sub})` : type, cpuMs: Number(cpu100ns) / 1e4, privMB: Number(priv) / 1048576 }];
    }));
}

const ANIMATIONS = `(() => {
    const out = {};
    for (const a of document.getAnimations()) {
        if (a.playState !== "running") continue;
        const t = a.effect?.target;
        const key = (a.animationName || a.transitionProperty || a.constructor.name) + " @ "
            + (t ? t.tagName.toLowerCase() + (t.className && typeof t.className === "string" ? "." + t.className.split(" ")[0] : "") : "?")
            + (a.effect?.getTiming?.().iterations === Infinity ? " (infinite)" : "");
        out[key] = (out[key] ?? 0) + 1;
    }
    return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 25);
})()`;

const result = {};
try {
    await killDiscord(inst);
    launchDiscord(inst, { variant: "mod", port: PORT });
    const target = await waitForMainTarget(PORT, 120000);
    const cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.eval(`new Promise(res => (function t() { document.querySelector('[data-list-id="guildsnav"]') ? res() : setTimeout(t, 100); })())`, 130000);
    log(`Discord ready, settling ${SETTLE} s`);
    await sleep(SETTLE * 1000);

    result.animations = await cdp.eval(ANIMATIONS);

    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
    await cdp.send("Profiler.start");
    const a = processSnapshot();
    const t0 = Date.now();
    log(`profiling ${SECONDS} s idle, don't touch Discord`);
    await sleep(SECONDS * 1000);
    const b = processSnapshot();
    const wall = Date.now() - t0;
    const { profile } = await cdp.send("Profiler.stop", {}, 60000);

    // CPU per process type (% of one core)
    const byType = {};
    for (const [pid, p] of b) {
        const before = a.get(pid)?.cpuMs ?? 0;
        const e = byType[p.type] ??= { count: 0, cpuPct: 0, privMB: 0 };
        e.count++;
        e.cpuPct += ((p.cpuMs - before) / wall) * 100;
        e.privMB += p.privMB;
    }
    result.processes = Object.entries(byType).sort((x, y) => y[1].cpuPct - x[1].cpuPct)
        .map(([type, e]) => ({ type, count: e.count, cpuPct: +e.cpuPct.toFixed(2), privMB: Math.round(e.privMB) }));

    // renderer profile: self time per function
    const dt = new Map();
    profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000));
    const fns = new Map();
    let total = 0;
    for (const n of profile.nodes) {
        const ms = dt.get(n.id) ?? 0;
        total += ms;
        const c = n.callFrame;
        const key = `${c.functionName || "(anonymous)"}|${c.scriptId}|${c.lineNumber}|${c.columnNumber}|${c.url}`;
        fns.set(key, (fns.get(key) ?? 0) + ms);
    }
    const idle = [...fns].filter(([k]) => /^\((idle|program|garbage collector)\)/.test(k)).reduce((s, [, v]) => s + v, 0);
    result.rendererProfile = { totalMs: Math.round(total), busyMs: Math.round(total - idle) };

    const sources = new Map();
    const snippet = async (scriptId, line, col) => {
        if (!scriptId || scriptId === "0") return "";
        if (!sources.has(scriptId)) {
            sources.set(scriptId, await cdp.send("Debugger.getScriptSource", { scriptId }).then(r => r.scriptSource.split("\n"), () => null));
        }
        const l = sources.get(scriptId)?.[line];
        return l ? l.slice(Math.max(0, col - 40), col + 160) : "";
    };
    await cdp.send("Debugger.enable");
    result.hot = [];
    for (const [k, ms] of [...fns].filter(([k]) => !k.startsWith("(")).sort((x, y) => y[1] - x[1]).slice(0, 25)) {
        const [name, scriptId, line, col, url] = k.split("|");
        result.hot.push({ ms: +ms.toFixed(1), name, url: url.replace(/^.*\//, ""), line: +line + 1, code: await snippet(scriptId, +line, +col) });
    }
    await cdp.send("Debugger.disable");
    cdp.close();
} finally {
    await killDiscord(inst).catch(() => { });
    relaunchNormally(inst);
}

const file = join(process.env.TEMP ?? ".", `discord-diagnose-${Date.now()}.json`);
writeFileSync(file, JSON.stringify(result, null, 2));
console.log("\nCPU per process type (% of one core, private MB):");
for (const p of result.processes) console.log(`  ${p.cpuPct.toFixed(2).padStart(6)} %  ${String(p.privMB).padStart(5)} MB  ${p.count}× ${p.type}`);
console.log(`\nRenderer JS: ${result.rendererProfile.busyMs} ms busy of ${result.rendererProfile.totalMs} ms`);
console.log("\nHottest renderer functions (self ms):");
for (const h of result.hot.slice(0, 15)) console.log(`  ${String(h.ms).padStart(7)}  ${h.name} (${h.url}:${h.line})\n           ${h.code.replace(/\s+/g, " ").slice(0, 150)}`);
console.log("\nRunning animations:");
for (const [k, n] of result.animations) console.log(`  ${n}× ${k}`);
console.log(`\nFull result: ${file}`);
