// Discord install discovery, bench stub install/removal, launch and kill.
import { execFileSync, spawn } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";

import { buildAsar, readAsar } from "./asar.mjs";

export const BRANCHES = {
    stable: { dir: "Discord", exe: "Discord.exe", proc: "Discord" },
    ptb: { dir: "DiscordPTB", exe: "DiscordPTB.exe", proc: "DiscordPTB" },
    canary: { dir: "DiscordCanary", exe: "DiscordCanary.exe", proc: "DiscordCanary" },
};

const STUB_MARKER = "VC_BENCH_VARIANT";

function versionKey(name) {
    return name.slice(4).split(".").map(Number);
}

export function findInstall(branch) {
    const b = BRANCHES[branch];
    if (!b) throw new Error(`Unknown branch "${branch}"`);
    const root = join(process.env.LOCALAPPDATA, b.dir);
    if (!existsSync(root)) throw new Error(`Discord ${branch} not found at ${root}`);

    const latest = readdirSync(root)
        .filter(d => d.startsWith("app-"))
        .sort((a, b2) => {
            const x = versionKey(a), y = versionKey(b2);
            for (let i = 0; i < Math.max(x.length, y.length); i++) {
                if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
            }
            return 0;
        })
        .at(-1);
    if (!latest) throw new Error(`No app-* folder in ${root}`);

    const appDir = join(root, latest);
    const resources = join(appDir, "resources");
    return {
        ...b,
        branch,
        root,
        version: latest.slice(4),
        exePath: join(appDir, b.exe),
        resources,
        appAsar: join(resources, "app.asar"),
        origAsar: join(resources, "_app.asar"),
    };
}

// The stub behaves exactly like the normal Vencord injector unless VC_BENCH_VARIANT=stock,
// in which case it boots the original Discord app.asar without any mod.
function stubSource(patcherPath) {
    return `// ${STUB_MARKER} bench stub (vencord stuff/bench). Without the env var this is the normal injector.
if (process.env.${STUB_MARKER} === "stock") {
    const { app } = require("electron");
    const path = require("path");
    const asar = path.join(__dirname, "..", "_app.asar");
    const pkg = require(path.join(asar, "package.json"));
    require.main.filename = path.join(asar, pkg.main);
    app.setAppPath(asar);
    require(require.main.filename);
} else {
    require(${JSON.stringify(patcherPath)});
}
`;
}

function plainSource(patcherPath) {
    return `require(${JSON.stringify(patcherPath)})`;
}

const PKG = '{\n\t"name": "discord",\n\t"main": "index.js"\n}';

/** Reads the current injector and returns the patcher path it points to. */
export function readInjector(inst) {
    if (!existsSync(inst.origAsar)) {
        throw new Error(`${inst.resources} is not injected (no _app.asar). Run "npm run inject" first.`);
    }
    if (statSync(inst.appAsar).size > 64 * 1024) {
        throw new Error(`${inst.appAsar} looks like Discord's real app.asar, refusing to touch it.`);
    }
    const files = readAsar(readFileSync(inst.appAsar));
    const src = files["index.js"] ?? "";
    const m = src.match(/require\(("(?:[^"\\]|\\.)*")\)\s*;?\s*}?\s*$/);
    if (!m) throw new Error(`Unexpected injector in ${inst.appAsar}:\n${src}`);
    return { patcherPath: JSON.parse(m[1]), isBenchStub: src.includes(STUB_MARKER) };
}

export function installStub(inst) {
    const { patcherPath, isBenchStub } = readInjector(inst);
    if (isBenchStub) return patcherPath;
    writeFileSync(inst.appAsar, buildAsar({ "index.js": stubSource(patcherPath), "package.json": PKG }));
    return patcherPath;
}

export function removeStub(inst) {
    const { patcherPath, isBenchStub } = readInjector(inst);
    if (!isBenchStub) return false;
    writeFileSync(inst.appAsar, buildAsar({ "index.js": plainSource(patcherPath), "package.json": PKG }));
    return true;
}

export function listPids(inst) {
    try {
        const out = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${inst.exe}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
        return out.split(/\r?\n/).map(l => l.split('","')[1]).filter(Boolean).map(Number);
    } catch {
        return [];
    }
}

export async function killDiscord(inst, timeoutMs = 20000) {
    if (!listPids(inst).length) return;
    try {
        execFileSync("taskkill", ["/F", "/T", "/IM", inst.exe], { stdio: "ignore" });
    } catch { /* already gone */ }
    const until = Date.now() + timeoutMs;
    while (listPids(inst).length) {
        if (Date.now() > until) throw new Error("Discord did not exit");
        await sleep(250);
    }
    // give the OS a moment to release the single-instance lock and file handles
    await sleep(1500);
}

export function launchDiscord(inst, { variant, port }) {
    const env = { ...process.env };
    if (variant === "stock") env[STUB_MARKER] = "stock";
    else delete env[STUB_MARKER];
    const child = spawn(inst.exePath, [`--remote-debugging-port=${port}`], {
        detached: true,
        stdio: "ignore",
        env,
        cwd: join(inst.exePath, ".."),
    });
    child.unref();
    return Date.now();
}

/** Restores a normal Discord start (no debug port, no bench env) after the benchmark. */
export function relaunchNormally(inst) {
    const updateExe = join(inst.root, "Update.exe");
    const env = { ...process.env };
    delete env[STUB_MARKER];
    spawn(updateExe, ["--processStart", inst.exe], { detached: true, stdio: "ignore", env }).unref();
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
