// One benchmark run: cold start → settle → idle → memory → channel switches → scroll → minimized idle.
import { execFileSync } from "child_process";

import { CDP, waitForMainTarget } from "./cdp.mjs";
import { killDiscord, launchDiscord, sleep } from "./discord.mjs";
import { cpuDelta, totals } from "./procs.mjs";

// Installed into the page once. Uses setTimeout polling (not rAF) so it also works while hidden.
const PAGE_HELPERS = `(() => {
    if (window.__bench) return true;
    const b = window.__bench = { lt: [], frames: null };
    try {
        new PerformanceObserver(l => { for (const e of l.getEntries()) b.lt.push([e.startTime, e.duration]); })
            .observe({ type: "longtask", buffered: true });
    } catch {}
    b.waitFor = (fn, timeout) => new Promise(res => {
        const t0 = performance.now();
        (function tick() {
            let ok = false;
            try { ok = fn(); } catch {}
            if (ok) return res(performance.now());
            if (performance.now() - t0 > timeout) return res(-1);
            setTimeout(tick, 10);
        })();
    });
    b.ready = () => !!document.querySelector('[data-list-id="guildsnav"]')
        && !!document.querySelector('[data-list-id="chat-messages"] li[id^="chat-messages-"], [class*="peopleColumn"]');
    b.go = path => {
        if (location.pathname === path) return;
        history.pushState(history.state, "", path);
        dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    };
    b.messagesOf = cid => document.querySelector('li[id^="chat-messages-' + cid + '-"]');
    b.scroller = () => {
        let el = document.querySelector('[data-list-id="chat-messages"]');
        while (el && el !== document.body) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return el;
            el = el.parentElement;
        }
        return null;
    };
    b.longTasks = (from, to) => {
        const l = b.lt.filter(([s]) => s >= from && s <= to);
        return { count: l.length, totalMs: l.reduce((a, [, d]) => a + d, 0) };
    };
    b.recStart = () => {
        const frames = b.frames = [];
        let last = performance.now();
        const f = t => { if (b.frames !== frames) return; frames.push(t - last); last = t; requestAnimationFrame(f); };
        requestAnimationFrame(f);
    };
    b.recStop = () => { const f = b.frames || []; b.frames = null; return f.slice(1); };
    return true;
})()`;

/** Collects channel paths to use for switching/scrolling from the currently open guild or DMs. */
export async function pickChannels(cdp, max = 6) {
    return cdp.eval(`(() => {
        const here = location.pathname;
        const links = [...document.querySelectorAll('a[href^="/channels/"]')]
            .map(a => a.getAttribute("href"))
            .filter(h => /^\\/channels\\/[^/]+\\/\\d+$/.test(h));
        const guild = here.split("/")[2];
        const same = links.filter(h => h.split("/")[2] === guild);
        const list = [...new Set([here, ...(same.length >= 3 ? same : links)])]
            .filter(h => /^\\/channels\\/[^/]+\\/\\d+$/.test(h));
        return list.slice(0, ${max});
    })()`);
}

const cid = path => path.split("/").at(-1);

function setWindowState(proc, state) {
    // 6 = SW_MINIMIZE, 9 = SW_RESTORE
    const cmd = `Add-Type -Name W -Namespace B -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);';`
        + `Get-Process -Name '${proc}' | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [void][B.W]::ShowWindow($_.MainWindowHandle, ${state}) }`;
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { windowsHide: true });
}

function nearest(samples, t) {
    return samples.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best));
}

async function idleWindow(cdp, sampler, seconds) {
    await sampler.waitForSample();
    const t0 = Date.now();
    const p0 = await cdp.eval("performance.now()");
    const m0 = await cdp.metrics();
    await sleep(seconds * 1000);
    const t1 = Date.now();
    const p1 = await cdp.eval("performance.now()");
    const m1 = await cdp.metrics();
    await sampler.waitForSample(t1);

    const samples = sampler.between(t0 - 1500, Date.now());
    const a = nearest(samples, t0), b = nearest(samples, t1);
    const wallMs = b.t - a.t;
    const lt = await cdp.eval(`__bench.longTasks(${p0}, ${p1})`);
    return {
        cpuPct: (cpuDelta(a, b) / wallMs) * 100, // % of one core, whole process tree
        rendererBusyPct: ((m1.TaskDuration - m0.TaskDuration) * 1000 / (p1 - p0)) * 100,
        rendererScriptMs: (m1.ScriptDuration - m0.ScriptDuration) * 1000,
        longTasks: lt.count,
    };
}

async function memorySnapshot(cdp, sampler) {
    await cdp.send("HeapProfiler.collectGarbage");
    await sleep(3000);
    const from = Date.now();
    await sleep(5000);
    await sampler.waitForSample(Date.now());
    const s = sampler.between(from, Date.now()).map(totals);
    const priv = s.map(x => x.priv).sort((x, y) => x - y)[Math.floor(s.length / 2)];
    const ws = s.map(x => x.ws).sort((x, y) => x - y)[Math.floor(s.length / 2)];
    const m = await cdp.metrics();
    return {
        privateMB: priv / 1048576,
        workingSetMB: ws / 1048576,
        processes: s.at(-1)?.count ?? 0,
        jsHeapMB: m.JSHeapUsedSize / 1048576,
        domNodes: m.Nodes,
        listeners: m.JSEventListeners,
    };
}

async function channelSwitches(cdp, channels, count) {
    const times = [];
    const p0 = await cdp.eval("performance.now()");
    for (let i = 0; i < count; i++) {
        const path = channels[(i + 1) % channels.length];
        const ms = await cdp.eval(`(async () => {
            const t0 = performance.now();
            __bench.go(${JSON.stringify(path)});
            const done = await __bench.waitFor(() => __bench.messagesOf(${JSON.stringify(cid(path))}), 8000);
            return done < 0 ? -1 : done - t0;
        })()`);
        if (ms >= 0) times.push(ms);
        await sleep(700);
    }
    const p1 = await cdp.eval("performance.now()");
    const lt = await cdp.eval(`__bench.longTasks(${p0}, ${p1})`);
    const sorted = [...times].sort((a, b) => a - b);
    return {
        switchMedianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
        switchTimeouts: count - times.length,
        switchLongTasks: lt.count,
        switchLongTaskMs: lt.totalMs,
    };
}

async function scrollTest(cdp, channel) {
    await cdp.eval(`__bench.go(${JSON.stringify(channel)})`);
    await cdp.eval(`__bench.waitFor(() => __bench.messagesOf(${JSON.stringify(cid(channel))}), 8000)`);
    await sleep(2000);
    const rect = await cdp.eval(`(() => {
        const s = __bench.scroller();
        if (!s) return null;
        const r = s.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (!rect) return { scrollError: "no scroller" };

    const gesture = yDistance => cdp.send("Input.synthesizeScrollGesture",
        { x: rect.x, y: rect.y, yDistance, speed: 1500, gestureSourceType: "mouse" }, 30000);

    // warm-up: load older history once so the measured part scrolls mostly loaded content
    await gesture(2000);
    await sleep(1500);
    await gesture(-2000);
    await sleep(1000);

    const p0 = await cdp.eval("performance.now()");
    await cdp.eval("__bench.recStart()");
    for (let i = 0; i < 2; i++) {
        await gesture(1500);
        await gesture(-1500);
    }
    const frames = await cdp.eval("__bench.recStop()");
    const p1 = await cdp.eval("performance.now()");
    const lt = await cdp.eval(`__bench.longTasks(${p0}, ${p1})`);

    const sorted = [...frames].sort((a, b) => a - b);
    const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    return {
        frames: sorted.length,
        frameP50Ms: q(0.5),
        // average frame time = 1000 / fps; replaces "dropped frames", which judged each variant by its own median and so rewarded a steady 60 fps over a mixed 120/60 fps
        frameP95Ms: q(0.95),
        frameP99Ms: q(0.99),
        frameMeanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
        scrollLongTasks: lt.count,
    };
}

export async function runOnce(inst, sampler, { variant, port, cfg, setup = false, log }) {
    await killDiscord(inst);
    const spawnedAt = launchDiscord(inst, { variant, port });

    const target = await waitForMainTarget(port, 120000);
    const cdp = await CDP.connect(target.webSocketDebuggerUrl);
    try {
        await cdp.send("Performance.enable");
        await cdp.eval(`(${waitScript()})()`, 130000); // waits until __bench can be installed
        await cdp.eval(PAGE_HELPERS);
        const readyAt = await cdp.eval(`__bench.waitFor(__bench.ready, 120000).then(t => t < 0 ? -1 : performance.timeOrigin + t)`, 130000);
        if (readyAt < 0) throw new Error("Discord UI never became ready");

        const result = {
            variant,
            startupMs: readyAt - spawnedAt,
            rendererReadyMs: readyAt - await cdp.eval("performance.timeOrigin"),
        };

        if (!cfg.channels?.length) {
            cfg.channels = await pickChannels(cdp);
            log(`  picked channels: ${cfg.channels.join(", ")}`);
        }
        if (cfg.channels.length < 2) throw new Error("Need at least 2 channels; open a server with several text channels or set \"channels\" in bench/config.json");

        // start every measured phase from the same channel
        await cdp.eval(`__bench.go(${JSON.stringify(cfg.channels[0])})`);
        log(`  ready after ${(result.startupMs / 1000).toFixed(1)} s, settling ${cfg.settleSec} s`);
        await sleep(cfg.settleSec * 1000);

        if (setup) return result;

        await cdp.send("HeapProfiler.collectGarbage");
        log(`  idle (focused) ${cfg.idleSec} s`);
        const idle = await idleWindow(cdp, sampler, cfg.idleSec);
        result.idleCpuPct = idle.cpuPct;
        result.idleRendererBusyPct = idle.rendererBusyPct;
        result.idleScriptMs = idle.rendererScriptMs;
        result.idleLongTasks = idle.longTasks;

        log("  memory");
        Object.assign(result, await memorySnapshot(cdp, sampler));

        log(`  ${cfg.switches} channel switches`);
        Object.assign(result, await channelSwitches(cdp, cfg.channels, cfg.switches));

        log("  scroll");
        Object.assign(result, await scrollTest(cdp, cfg.channels[0]));

        log(`  idle (minimized) ${cfg.minimizedSec} s`);
        setWindowState(inst.proc, 6);
        await sleep(3000);
        const hidden = await idleWindow(cdp, sampler, cfg.minimizedSec);
        result.minimizedCpuPct = hidden.cpuPct;
        result.minimizedRendererBusyPct = hidden.rendererBusyPct;
        setWindowState(inst.proc, 9);

        // leave Discord on the first channel so the next cold start opens the same view
        await cdp.eval(`__bench.go(${JSON.stringify(cfg.channels[0])})`);
        await sleep(2000);
        return result;
    } finally {
        cdp.close();
    }
}

// Resolves once the document is far enough loaded to run our helpers.
function waitScript() {
    return `() => new Promise(res => {
        (function tick() { if (document.body) return res(true); setTimeout(tick, 20); })();
    })`;
}
