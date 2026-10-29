/*
 * Baut Vencord mit allen eigenen Plugins aus diesem Ordner.
 *
 *   node build.mjs              Plugins synchronisieren + bauen
 *   node build.mjs --inject     ... und in dein Discord installieren
 *   node build.mjs --package    ... und ein Paket für Freunde erstellen (release/)
 *   node build.mjs --release    ... Paket bauen und als GitHub-Release veröffentlichen
 *                               (Freunde bekommen es dann über den Vencord-Updater)
 *   node build.mjs --update     vorher Vencord aktualisieren (git pull + pnpm install)
 *   node build.mjs --android    ... und die browser.js für die Android-App (VendroidEnhanced) bauen
 *   node build.mjs --apk        ... und die Android-App selbst (release/VoidCord-Android.apk);
 *                               --release baut sie nur, wenn sich android/app seit dem letzten Release geändert hat
 *
 * Jeder Unterordner mit einer index.ts / index.tsx gilt als Plugin.
 */

import { execSync } from "child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const VENCORD = join(ROOT, "Vencord");
const USERPLUGINS = join(VENCORD, "src", "userplugins");
const MANAGED_FILE = join(USERPLUGINS, ".managed.json");
const RELEASE = join(ROOT, "release");
// What friends get: one standalone exe; files/ is only the staging folder for what gets embedded into it
const FILES = join(RELEASE, "files");
const INSTALLER = join(RELEASE, "VoidCord-Installer.exe");
const IGNORED = new Set(["Vencord", "release", "node_modules", "dist"]);
// GitHub-Repo, aus dessen Releases der Vencord-Updater der Freunde lädt (muss öffentlich sein)
const REPO = "HW1312/VoidCord";

const args = new Set(process.argv.slice(2));
if (args.has("--release")) args.add("--package");
const run = (cmd, cwd = VENCORD, env = {}) => execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
const git = cmd => execSync(`git ${cmd}`, { cwd: ROOT, encoding: "utf-8" }).trim();

if (!existsSync(VENCORD)) {
    console.error("Vencord-Ordner fehlt. Einmalig ausführen:\n  git clone https://github.com/Vendicated/Vencord.git && cd Vencord && pnpm install");
    process.exit(1);
}

// Version des Pakets = Commit dieses Ordners. Der Updater der Freunde vergleicht ihn mit dem
// Namen des neuesten Releases auf REPO und lädt bei Unterschied die neuen Dateien herunter.
let hash;
if (args.has("--package")) {
    hash = git("rev-parse --short HEAD");
    if (git("status --porcelain")) {
        if (args.has("--release")) {
            console.error("Es gibt nicht committete Änderungen. Erst committen, dann --release.");
            process.exit(1);
        }
        console.warn(`Achtung: nicht committete Änderungen, das Paket trägt trotzdem die Version ${hash}.`);
    }
}

if (args.has("--update")) {
    run("git pull");
    run("pnpm install --frozen-lockfile");
}

// ---- Plugins synchronisieren
const plugins = readdirSync(ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && !IGNORED.has(d.name) && !/^[._]/.test(d.name))
    .filter(d => ["index.ts", "index.tsx"].some(f => existsSync(join(ROOT, d.name, f))))
    .map(d => d.name);

// Gemeinsame Ordner (beginnen mit "_", Vencord lädt sie nicht als Plugin): z. B. _ui = Apple-UI-Kit aller Plugins
const shared = readdirSync(ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^_[a-z]/i.test(d.name))
    .map(d => d.name);

/** Ersetzt die verwalteten Ordner in userplugins durch diese [Name, Quellordner] */
function syncFolders(list) {
    mkdirSync(USERPLUGINS, { recursive: true });
    const previous = existsSync(MANAGED_FILE) ? JSON.parse(readFileSync(MANAGED_FILE, "utf-8")) : [];
    for (const name of previous) rmSync(join(USERPLUGINS, name), { recursive: true, force: true });
    for (const [name, src] of list) cpSync(src, join(USERPLUGINS, name), { recursive: true });
    writeFileSync(MANAGED_FILE, JSON.stringify(list.map(([name]) => name)));
}

function syncAll() {
    syncFolders([...plugins, ...shared].map(name => [name, join(ROOT, name)]));

    // Wann jedes Plugin dazukam (PluginHub sortiert danach und zeigt "NEW"):
    // frühestes Datum aus Ordner-Erstellung und erstem Git-Commit
    const added = {};
    for (const dir of plugins) {
        const file = ["index.ts", "index.tsx"].map(f => join(ROOT, dir, f)).find(existsSync);
        const name = readFileSync(file, "utf-8").match(/definePlugin\(\{[\s\S]*?\bname:\s*"([^"]+)"/)?.[1];
        if (!name) continue;
        const dates = [statSync(join(ROOT, dir)).birthtimeMs];
        try {
            const first = git(`log --diff-filter=A --format=%ct -- "${dir}"`).split("\n").filter(Boolean).at(-1);
            if (first) dates.push(Number(first) * 1000);
        } catch { }
        added[name] = Math.round(Math.min(...dates.filter(d => d > 0)));
    }
    writeFileSync(join(USERPLUGINS, "PluginHub", "added.json"), JSON.stringify(added));

    // Themes für den Theme Hub im PluginHub: jeder Unterordner von Themes/ mit einer *.theme.css.
    // themes.json = Metadaten für die Oberfläche, themes-data.json = CSS, das nur native.ts kennt
    // (so schreibt native.ts ausschließlich eigene Themes in den Theme-Ordner).
    const THEMES = join(ROOT, "Themes");
    const themeMeta = [];
    const themeData = {};
    if (existsSync(THEMES)) {
        for (const d of readdirSync(THEMES, { withFileTypes: true })) {
            if (!d.isDirectory()) continue;
            const dir = join(THEMES, d.name);
            const fileName = readdirSync(dir).find(f => f.endsWith(".theme.css"));
            if (!fileName) continue;
            const css = readFileSync(join(dir, fileName), "utf-8");
            const header = css.match(/^\s*\/\*\*([\s\S]*?)\*\//)?.[1] ?? "";
            const meta = Object.fromEntries([...header.matchAll(/@(\w+)[ \t]+([^\r\n]+)/g)].map(m => [m[1], m[2].trim()]));
            const extra = existsSync(join(dir, "theme.json")) ? JSON.parse(readFileSync(join(dir, "theme.json"), "utf-8")) : {};
            themeMeta.push({
                id: d.name,
                fileName,
                name: meta.name ?? d.name,
                author: meta.author ?? "",
                version: meta.version ?? "1.0.0",
                description: meta.description ?? "",
                colors: extra.colors ?? []
            });
            themeData[d.name] = { fileName, css };
        }
    }
    writeFileSync(join(USERPLUGINS, "PluginHub", "themes.json"), JSON.stringify(themeMeta));
    writeFileSync(join(USERPLUGINS, "PluginHub", "themes-data.json"), JSON.stringify(themeData));

    return themeMeta;
}

const themeMeta = syncAll();
console.log(`Plugins: ${plugins.join(", ") || "(keine)"}`);
console.log(`Themes: ${themeMeta.map(t => t.name).join(", ") || "(keine)"}`);

// ---- Bauen

/**
 * Eigene Einstellungen pro Discord-Client: Vencord legt sonst Stable, PTB und Canary in denselben Ordner
 * (%APPDATA%\Vencord) – dann hätte Canary nach der Installation alle Plugins von Stable, und ein Plugin, das man
 * in einem Client ausschaltet, wäre in allen aus. Stable bleibt im alten Ordner, PTB / Canary bekommen
 * Vencord-ptb / Vencord-canary. Steht ganz oben in patcher.js, also bevor Vencord den Ordner bestimmt.
 */
const PER_CLIENT_SETTINGS = "// VoidCord: own settings per Discord client\n"
    + "try{const{app:a}=require(\"electron\"),p=require(\"path\"),u=a.getPath(\"userData\"),n=p.basename(u).toLowerCase();"
    + "if(!process.env.VENCORD_USER_DATA_DIR&&n.startsWith(\"discord\")&&n!==\"discord\")"
    + "process.env.VENCORD_USER_DATA_DIR=p.join(u,\"..\",\"Vencord-\"+n.slice(7))}catch{}\n";

/**
 * Branding: visible texts in Vencord's own UI say "VoidCord" instead of "Vencord" (settings section and page titles,
 * toolbox tooltip, update notices, descriptions). Only the build sees the change – the sources are restored right
 * after, so the Vencord checkout stays clean for git pull. Identifiers (Vencord.Api, VencordNative, setting keys)
 * are untouched: only a standalone word "Vencord" with text-like neighbours is replaced.
 */
const BRAND_FILES = [
    "plugins/_core/settings.tsx",
    "plugins/vencordToolbox/index.tsx",
    "api/ChatButtons.tsx",
    "api/SettingsSync/offline.ts",
    "main/csp/manager.ts",
    "Vencord.ts",
    ...readdirSync(join(VENCORD, "src", "components", "settings"), { recursive: true })
        .filter(f => /\.tsx?$/.test(f))
        .map(f => `components/settings/${f.replaceAll("\\", "/")}`)
];
// preceded by a quote, ">" or a space that follows a letter/quote/">" (so "typeof Vencord" in code stays),
// not followed by an identifier character, "." or "/" (Vencord.Api, Vencord/src paths)
const BRAND_RE = /(?<=["'`>]|[A-Za-z,:;!?"'`>] )Vencord(?![\w$./])/g;
// lines that really mean the Vencord project (donations, contributors, Vesktop note) keep the name
const BRAND_KEEP = /donat|contribut|Vesktop/i;
const brand = src => src.split("\n").map(l => (BRAND_KEEP.test(l) ? l : l.replace(BRAND_RE, "VoidCord"))).join("\n");

/**
 * Changed defaults of Vencord's own plugins (same trick: only during the build). Existing installs get them once
 * through PluginHub's PERF_DEFAULTS, because Vencord saves defaults into settings.json.
 */
const SOURCE_TWEAKS = [
    // BetterSettings eagerLoad: +15 000 CSS rules and +17 MB heap at start (bench, 2026-10-12)
    ["plugins/betterSettings/index.tsx", /(eagerLoad: \{[^}]*?default: )true/, "$1false"],
    // BetterFolders: Discord now declares variables before the props ("let n,i,s,o,{disableAppDownload:…"), the
    // patch no longer matched, so the whole guildsnav patch was dropped and the sidebar showed every server
    // twice (2026-10-29). Without "let" it matches old and new Discord – remove once Vencord fixes it.
    ["plugins/betterFolders/index.tsx", /match: \/let\{disableAppDownload:/, "match: /{disableAppDownload:"]
];

function withBranding(fn) {
    const originals = new Map();
    try {
        for (const [rel, re, to] of SOURCE_TWEAKS) {
            const file = join(VENCORD, "src", rel);
            const src = readFileSync(file, "utf8");
            if (!re.test(src)) throw new Error(`Source tweak no longer matches (Vencord changed?): ${rel}`);
            originals.set(file, src);
            writeFileSync(file, src.replace(re, to));
        }
        for (const rel of BRAND_FILES) {
            const file = join(VENCORD, "src", rel);
            const src = readFileSync(file, "utf8");
            const out = brand(src);
            if (out !== src) {
                if (!originals.has(file)) originals.set(file, src);
                writeFileSync(file, out);
            }
        }
        fn();
    } finally {
        for (const [file, src] of originals) writeFileSync(file, src);
    }
}

function build(env) {
    withBranding(() => run(`pnpm build${env ? " --standalone" : ""}`, VENCORD, env));
    const patcher = join(VENCORD, "dist", "patcher.js");
    // After "use strict" – in front of it, the bundle would no longer run in strict mode
    const code = readFileSync(patcher, "utf8").replace('"use strict";', `"use strict";${PER_CLIENT_SETTINGS}`);
    writeFileSync(patcher, code);
}

build();

if (args.has("--inject")) run("pnpm inject");

// ---- Android (VendroidEnhanced)
// VendroidEnhanced lädt Discord Web und spielt eine browser.js ein – deren URL steht in seinen Entwickler-Einstellungen
// ("Vencord location"). Diese hier enthält nur, was das Handy braucht: ANDROID_PLUGINS samt allem, was sie aus
// anderen Plugin-Ordnern importieren, die Vendroid-Plugins (Einstellungen, handytaugliche Fenster) und
// VoidCordMobile, das ANDROID_PLUGINS einschaltet. Plugins mit native.ts gehen dort nicht (kein Electron).
const ANDROID = join(ROOT, "android");
const ANDROID_PLUGINS = ["SecretChat"];
const ANDROID_OUT = join(RELEASE, "android", "voidcord-android.js");
// Vencord-Plugins, die im Android-WebView nicht gehen – wie VendroidEnhanced's blacklisted-plugins.txt.
// webScreenShare ruft beim Laden navigator.mediaDevices.getDisplayMedia.bind auf: das gibt es dort nicht,
// und dann bricht die ganze browser.js ab (kein Vencord, keine Vendroid-Einstellungen).
const ANDROID_EXCLUDED = ["alwaysAnimate", "webScreenShare.browser", "webScreenShareFixes.web", "webPWA.browser"];

/** Plugin-Ordner, die diese Ordner über "../Ordner" oder "../Ordner/…" importieren – rekursiv */
function importedFolders(start) {
    const found = new Set(start);
    const queue = [...start];
    while (queue.length) {
        const dir = join(ROOT, queue.pop());
        for (const f of readdirSync(dir, { recursive: true })) {
            if (!/\.[jt]sx?$/.test(f)) continue;
            const src = readFileSync(join(dir, f), "utf-8");
            for (const [, name] of src.matchAll(/(?:from|import)\s*["']\.\.\/([^/"']+)[/"']/g)) {
                if (found.has(name) || shared.includes(name) || !existsSync(join(ROOT, name))) continue;
                found.add(name);
                queue.push(name);
            }
        }
    }
    return [...found];
}

function buildAndroid() {
    const folders = importedFolders(ANDROID_PLUGINS);
    const vendroid = join(ANDROID, "vendroid");
    syncFolders([
        ...[...folders, ...shared].map(name => [name, join(ROOT, name)]),
        ...readdirSync(vendroid, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => [d.name, join(vendroid, d.name)]),
        ["VoidCordMobile", join(ANDROID, "VoidCordMobile")]
    ]);
    console.log(`Android: ${folders.join(", ")} + Vendroid`);
    // Nur für diesen Build aus src/plugins heraus (nach dem Build wieder zurück, der Checkout bleibt sauber)
    const parked = join(VENCORD, ".android-excluded");
    const moved = [];
    try {
        mkdirSync(parked, { recursive: true });
        for (const name of ANDROID_EXCLUDED) {
            const dir = join(VENCORD, "src", "plugins", name);
            if (!existsSync(dir)) throw new Error(`Android: Vencord plugin ${name} not found (renamed?)`);
            renameSync(dir, join(parked, name));
            moved.push(name);
        }
        withBranding(() => run("pnpm buildWeb"));
    } finally {
        for (const name of moved) renameSync(join(parked, name), join(VENCORD, "src", "plugins", name));
        rmSync(parked, { recursive: true, force: true });
        // userplugins wieder mit allen Plugins, wie für dein Discord gebaut
        syncAll();
    }
    // Vendroid lädt nur das CSS des offiziellen Vencord – das eigene kommt mit in die js-Datei
    const css = readFileSync(join(VENCORD, "dist", "browser.css"), "utf-8");
    const addCss = `\n;(()=>{const add=()=>document.documentElement.appendChild(Object.assign(document.createElement("style"),{id:"voidcord-css",textContent:${JSON.stringify(css)}}));document.documentElement?add():document.addEventListener("DOMContentLoaded",add,{once:true})})();\n`;
    mkdirSync(dirname(ANDROID_OUT), { recursive: true });
    writeFileSync(ANDROID_OUT, readFileSync(join(VENCORD, "dist", "browser.js"), "utf-8") + addCss);
    console.log(`\nAndroid-Build: ${ANDROID_OUT}`);
}

// ---- Paket für Freunde
// Der Updater im Paket schaut auf REPO statt aufs offizielle Vencord, überschreibt also die eigenen Plugins nicht
if (args.has("--package")) {
    build({ VENCORD_REMOTE: REPO, VENCORD_HASH: hash });

    rmSync(RELEASE, { recursive: true, force: true });
    mkdirSync(join(FILES, "dist"), { recursive: true });

    for (const f of readdirSync(join(VENCORD, "dist"))) {
        if (/^(patcher|preload|renderer)\.(js|css)$/.test(f))
            cpSync(join(VENCORD, "dist", f), join(FILES, "dist", f));
    }

    // dist/ wieder auf den normalen Build für dein eigenes Discord zurücksetzen
    build();
    for (const f of ["Installer.ps1", "logo.png", "icon.png"])
        cpSync(join(ROOT, "share", f), join(FILES, f));
    // Shown in the installer window
    writeFileSync(join(FILES, "version.txt"), hash);

    // Everything in files/ goes into the exe as resources "files/<path>"; the exe unpacks them and
    // starts the installer window without a console. Compiled with the C# compiler that ships with Windows.
    const resources = readdirSync(FILES, { recursive: true, withFileTypes: true })
        .filter(d => d.isFile())
        .map(d => join(d.parentPath, d.name))
        .map(p => `/resource:"${p}",files/${p.slice(FILES.length + 1).replaceAll("\\", "/")}`);
    const csc = join(process.env.WINDIR, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    const sma = join(process.env.WINDIR, "Microsoft.NET", "assembly", "GAC_MSIL", "System.Management.Automation", "v4.0_3.0.0.0__31bf3856ad364e35", "System.Management.Automation.dll");
    execSync(`"${csc}" /nologo /target:winexe /optimize+ /win32icon:"${join(ROOT, "share", "icon.ico")}" /r:System.Windows.Forms.dll /r:"${sma}" ${resources.join(" ")} /out:"${INSTALLER}" "${join(ROOT, "share", "Launcher.cs")}"`, { stdio: "inherit" });
    console.log(`\nInstaller erstellt: ${INSTALLER} (Version ${hash})`);
}

// Nach dem Paket – --package leert release/. Jedes Release bekommt die Android-Datei, so bleibt die URL in
// VendroidEnhanced immer dieselbe: .../releases/latest/download/voidcord-android.js
if (args.has("--android") || args.has("--release")) buildAndroid();

// Die Android-App selbst (android/app, eigener Build von VendroidEnhanced). Signiert mit dem Schlüssel aus
// ~/.voidcord – ohne den gibt es keine APK, weil Updates immer denselben Schlüssel brauchen.
const APK_OUT = join(RELEASE, "VoidCord-Android.apk");
const KEYSTORE = join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".voidcord", "keystore.properties");
function buildApk() {
    if (!existsSync(KEYSTORE)) {
        console.warn(`Keine APK: ${KEYSTORE} fehlt (Signier-Schlüssel)`);
        return false;
    }
    const app = join(ANDROID, "app");
    const javaHome = process.env.JAVA_HOME ?? "C:\\Program Files\\Android\\Android Studio\\jbr";
    run(`"${join(app, process.platform === "win32" ? "gradlew.bat" : "gradlew")}" assembleRelease --no-daemon -q`, app, { JAVA_HOME: javaHome });
    cpSync(join(app, "app", "build", "outputs", "apk", "release", "app-release.apk"), APK_OUT);
    console.log(`\nAndroid-App: ${APK_OUT}`);
    return true;
}
// Ein Release baut die APK nur, wenn sich android/app seit dem letzten Release geändert hat (Gradle dauert ewig).
// Nichts lädt sie über releases/latest – nur voidcord-android.js muss in jedem Release liegen.
function apkChanged() {
    try {
        const last = execSync(`gh release view --repo ${REPO} --json tagName -q .tagName`, { cwd: ROOT, encoding: "utf-8" }).trim();
        return git(`diff --name-only ${last} HEAD -- android/app`) !== "";
    } catch {
        return true;
    }
}
const hasApk = (args.has("--apk") || (args.has("--release") && apkChanged())) && buildApk();
if (args.has("--release") && !hasApk) console.log("Keine APK in diesem Release: android/app unverändert (erzwingen mit --apk)");

// ---- GitHub-Release
if (args.has("--release")) {
    // Der Commit muss auf GitHub liegen, sonst findet der Updater keinen Changelog
    run("git push", ROOT);

    const assets = ["patcher.js", "preload.js", "renderer.js", "renderer.css"]
        .map(f => `"${join(FILES, "dist", f)}"`)
        // Older installers fetch the new exe from here to update themselves
        .concat(`"${INSTALLER}"`, `"${ANDROID_OUT}"`, hasApk ? [`"${APK_OUT}"`] : []);
    // Release notes = commit body, shown as changelog in the UpdateButton plugin. One line per change:
    //   - Added: Plugin X in the Plugin Hub
    //   - Fixed: Popout shows GIFs again
    //   - Removed: Stream checklist
    // Without a body the commit title is used.
    const body = git("log -1 --format=%b").split(/\r?\n/)
        .filter(l => l.trim() && !/^co-authored-by:/i.test(l.trim()))
        .join("\n");
    const notesFile = join(RELEASE, "notes.md");
    writeFileSync(notesFile, body || git("log -1 --format=%s"));

    run(`gh release create ${hash} ${assets.join(" ")} --repo ${REPO} --target ${git("rev-parse HEAD")} --title "VoidCord ${hash}" --notes-file "${notesFile}"`, ROOT);
    console.log(`\nRelease ${hash} veröffentlicht. Freunde bekommen es beim nächsten Discord-Start.`);
}
