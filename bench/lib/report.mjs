// Turns runs.jsonl into report.md (one table per variant vs the baseline variant).
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { compare, median, quantile } from "./stats.mjs";

// All metrics are "lower is better". minEffect = smallest change (%) we accept as a real effect.
export const METRICS = [
    { key: "startupMs", label: "Start until UI ready", unit: "ms", minEffect: 5 },
    { key: "rendererReadyMs", label: "Renderer load until UI ready", unit: "ms", minEffect: 5 },
    { key: "privateMB", label: "RAM (private bytes, all processes)", unit: "MB", minEffect: 2 },
    { key: "jsHeapMB", label: "JS heap after GC", unit: "MB", minEffect: 2 },
    { key: "domNodes", label: "DOM nodes", unit: "", minEffect: 2 },
    { key: "listeners", label: "JS event listeners", unit: "", minEffect: 2 },
    { key: "idleCpuPct", label: "CPU idle, window open", unit: "% core", minEffect: 5 },
    { key: "idleRendererBusyPct", label: "Renderer busy idle", unit: "%", minEffect: 5 },
    { key: "idleLongTasks", label: "Long tasks idle (>50 ms)", unit: "", minEffect: 5 },
    { key: "minimizedCpuPct", label: "CPU idle, minimized", unit: "% core", minEffect: 5 },
    { key: "switchMedianMs", label: "Channel switch (median)", unit: "ms", minEffect: 5 },
    { key: "switchLongTaskMs", label: "Long-task time during switches", unit: "ms", minEffect: 5 },
    { key: "frameP95Ms", label: "Scroll frame time p95", unit: "ms", minEffect: 5 },
    { key: "frameP99Ms", label: "Scroll frame time p99", unit: "ms", minEffect: 5 },
    { key: "frameMeanMs", label: "Scroll frame time mean (1000/fps)", unit: "ms", minEffect: 5 },
    { key: "workingSetMB", label: "Working set (info only, trimmable)", unit: "MB", minEffect: Infinity },
];

const fmt = v => (v == null || Number.isNaN(v) ? "–" : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(Math.abs(v) >= 10 ? 1 : 2));
const sign = v => (v > 0 ? "+" : "") + fmt(v);

export function loadRuns(dir) {
    return readFileSync(join(dir, "runs.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
}

export function writeReport(dir, meta) {
    const runs = loadRuns(dir).filter(r => !r.error && !r.warmup);
    const seen = new Set(runs.map(r => r.variant));
    // baseline = first variant in the config, not whichever ran first
    const variants = [...(meta.variants ?? []).map(v => v.name).filter(n => seen.has(n)), ...[...seen].filter(n => !(meta.variants ?? []).some(v => v.name === n))];
    const base = variants[0];
    const of = (v, key) => runs.filter(r => r.variant === v).map(r => r[key]).filter(x => typeof x === "number" && Number.isFinite(x));

    let md = `# Benchmark ${meta.started}\n\n`;
    md += `- Discord ${meta.branch} ${meta.discordVersion}, ${meta.cpu}, ${meta.ramGB} GB RAM\n`;
    md += `- Runs per variant: ${variants.map(v => `${v} ${of(v, "startupMs").length}`).join(", ")} (interleaved, plus ${meta.warmup} warm-up each)\n`;
    md += `- Settle ${meta.settleSec} s, idle ${meta.idleSec} s, minimized ${meta.minimizedSec} s, ${meta.switches} channel switches\n`;
    md += `- Baseline: **${base}**. Δ = change of the median, 95% bootstrap CI, Mann-Whitney p.\n`;
    md += "- **better/worse** only if CI excludes 0, p < 0.05 and the effect reaches the minimum (RAM 2 %, everything else 5 %). Lower is better everywhere.\n\n";

    // every variant vs the baseline, then the later variants against each other (e.g. a plugin tweak vs untweaked)
    const pairs = variants.flatMap((a, i) => variants.slice(i + 1).map(b => [a, b]));
    for (const [base, v] of pairs) {
        md += `## ${v} vs ${base}\n\n| Metric | ${base} median [IQR] | ${v} median [IQR] | Δ | 95% CI | p | Verdict |\n|---|---|---|---|---|---|---|\n`;
        for (const m of METRICS) {
            const a = of(base, m.key), b = of(v, m.key);
            if (a.length < 2 || b.length < 2) continue;
            const c = compare(a, b, m.minEffect);
            const iqr = xs => `${fmt(median(xs))} [${fmt(quantile(xs, 0.25))}–${fmt(quantile(xs, 0.75))}]`;
            const verdict = m.minEffect === Infinity ? "info" : c.verdict === "better" ? "✅ better" : c.verdict === "worse" ? "❌ worse" : "≈ not proven";
            md += `| ${m.label}${m.unit ? ` (${m.unit})` : ""} | ${iqr(a)} | ${iqr(b)} | ${sign(c.rel)} % | ${sign(c.ci[0])} … ${sign(c.ci[1])} % | ${c.p.toFixed(3)} | ${verdict} |\n`;
        }
        md += "\n";
    }

    const failed = loadRuns(dir).filter(r => r.error);
    if (failed.length) md += `## Failed runs\n\n${failed.map(r => `- ${r.variant} #${r.run}: ${r.error}`).join("\n")}\n`;

    writeFileSync(join(dir, "report.md"), md);
    return md;
}
