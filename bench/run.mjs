#!/usr/bin/env node
// Discord performance benchmark: stock Discord vs our Vencord build (and plugin variants).
//
//   node bench/run.mjs --yes              full run with bench/config.json
//   node bench/run.mjs --yes --quick      short smoke test (2 runs, shorter phases)
//   node bench/run.mjs --report <dir>     rebuild report.md from a results folder
//   node bench/run.mjs --remove-stub      restore the plain Vencord injector
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { cpus, totalmem } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { findInstall, installStub, killDiscord, relaunchNormally, removeStub, sleep } from "./lib/discord.mjs";
import { ProcSampler } from "./lib/procs.mjs";
import { writeReport } from "./lib/report.mjs";
import { runOnce } from "./lib/scenario.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(HERE, "config.json");

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = name => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};

// the channels are private DM/channel paths, so they live in a git-ignored file next to the config
const CHANNELS = join(HERE, "channels.local.json");

const fileCfg = JSON.parse(readFileSync(CONFIG, "utf8"));
const cfg = { ...fileCfg, channels: existsSync(CHANNELS) ? JSON.parse(readFileSync(CHANNELS, "utf8")) : [] };
if (opt("--runs")) cfg.runs = Number(opt("--runs"));
if (flag("--quick")) Object.assign(cfg, { runs: 2, warmup: 1, settleSec: 15, idleSec: 20, minimizedSec: 20, switches: 4 });
if (opt("--variants")) {
    const wanted = opt("--variants").split(",");
    cfg.variants = cfg.variants.filter(v => wanted.includes(v.name));
}

const inst = findInstall(cfg.branch);

if (opt("--report")) {
    const dir = opt("--report");
    console.log(writeReport(dir, JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"))));
    process.exit(0);
}
if (flag("--remove-stub")) {
    console.log(removeStub(inst) ? "Bench stub removed." : "No bench stub installed.");
    process.exit(0);
}

const perRunMin = (cfg.settleSec + cfg.idleSec + cfg.minimizedSec + 60) / 60;
const totalRuns = cfg.variants.length * (cfg.runs + cfg.warmup);
if (!flag("--yes")) {
    console.log(`This benchmark repeatedly KILLS and restarts Discord ${cfg.branch} ${inst.version} (${totalRuns} starts, ~${Math.round(totalRuns * perRunMin)} min).
Voice calls end, don't use the PC meanwhile (it adds noise). Variants: ${cfg.variants.map(v => v.name).join(", ")}.
Run again with --yes to start.`);
    process.exit(0);
}

// --- Vencord settings per variant (plugin on/off), restored afterwards ---
const settingsPath = join(process.env.APPDATA, cfg.branch === "stable" ? "Vencord" : `Vencord-${cfg.branch}`, "settings", "settings.json");
const settingsBackup = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : null;

function applyVariantSettings(variant) {
    if (!settingsBackup) return;
    const s = JSON.parse(settingsBackup);
    // { Name: true|false } toggles a plugin, { Name: { option: value } } overrides its options
    for (const [name, value] of Object.entries(variant.plugins ?? {})) {
        s.plugins[name] = { ...(s.plugins[name] ?? {}), ...(typeof value === "boolean" ? { enabled: value } : value) };
    }
    writeFileSync(settingsPath, JSON.stringify(s, null, 4));
}

// --- results folder ---
const started = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = join(HERE, "results", started);
mkdirSync(outDir, { recursive: true });
const meta = {
    started,
    branch: cfg.branch,
    discordVersion: inst.version,
    cpu: cpus()[0].model.trim(),
    ramGB: Math.round(totalmem() / 2 ** 30),
    ...Object.fromEntries(["runs", "warmup", "settleSec", "idleSec", "minimizedSec", "switches"].map(k => [k, cfg[k]])),
    variants: cfg.variants,
};
writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
const record = r => appendFileSync(join(outDir, "runs.jsonl"), JSON.stringify(r) + "\n");
const log = msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

const sampler = new ProcSampler(inst.proc);
let cleanedUp = false;
async function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    sampler.stop();
    if (settingsBackup) writeFileSync(settingsPath, settingsBackup);
    await killDiscord(inst).catch(() => { });
    removeStub(inst);
    relaunchNormally(inst);
    log("Restored settings and injector, Discord restarted normally.");
}
process.on("SIGINT", async () => {
    log("Interrupted, cleaning up…");
    await cleanup();
    process.exit(130);
});

installStub(inst);
log(`Discord ${cfg.branch} ${inst.version}, ${cfg.variants.length} variants × (${cfg.warmup} warm-up + ${cfg.runs} runs), results in ${outDir}`);

try {
    // Interleave variants and alternate their order each round (ABBA…) to cancel drift.
    const rounds = cfg.warmup + cfg.runs;
    for (let round = 0; round < rounds; round++) {
        const warmup = round < cfg.warmup;
        const order = round % 2 ? [...cfg.variants].reverse() : cfg.variants;
        for (const variant of order) {
            log(`${warmup ? "warm-up" : `run ${round - cfg.warmup + 1}/${cfg.runs}`}: ${variant.name}`);
            applyVariantSettings(variant);
            const mode = variant.stock ? "stock" : "mod";
            try {
                const r = await runOnce(inst, sampler, { variant: mode, port: cfg.port, cfg, setup: warmup, log });
                record({ ...r, variant: variant.name, run: round - cfg.warmup + 1, warmup });
                // persist auto-picked channels so later invocations use the same ones
                if (round === 0) writeFileSync(CHANNELS, JSON.stringify(cfg.channels, null, 4) + "\n");
            } catch (e) {
                log(`  FAILED: ${e.message}`);
                record({ variant: variant.name, run: round - cfg.warmup + 1, warmup, error: e.message });
                await sleep(3000);
            }
        }
    }
} finally {
    await cleanup();
}

console.log("\n" + writeReport(outDir, meta));
log(`Report: ${join(outDir, "report.md")}`);
