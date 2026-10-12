#!/usr/bin/env node
// CPU per named thread (Chromium thread descriptions) of every Discord process while idle.
//
//   node bench/threadprobe.mjs [--stock] [--seconds 30]
import { execFileSync } from "child_process";

import { waitForMainTarget } from "./lib/cdp.mjs";
import { findInstall, installStub, killDiscord, launchDiscord, relaunchNormally, removeStub, sleep } from "./lib/discord.mjs";

const PORT = 9229;
const argv = process.argv.slice(2);
const stock = argv.includes("--stock");
const SECONDS = argv.includes("--seconds") ? Number(argv[argv.indexOf("--seconds") + 1]) : 30;
const inst = findInstall("stable");

const PS = `
Add-Type -Name T -Namespace P -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern System.IntPtr OpenThread(int a, bool i, int id);
[DllImport("kernel32.dll")] public static extern int GetThreadDescription(System.IntPtr h, out System.IntPtr d);
[DllImport("kernel32.dll")] public static extern bool CloseHandle(System.IntPtr h);
[DllImport("kernel32.dll")] public static extern System.IntPtr LocalFree(System.IntPtr h);
'@
$types = @{}
Get-CimInstance Win32_Process -Filter "Name='${inst.exe}'" | ForEach-Object {
  $t = if ($_.CommandLine -match '--type=([\\w-]+)') { $matches[1] } else { 'main' }
  $types[[int]$_.ProcessId] = $t
}
foreach ($p in Get-Process -Name '${inst.proc}') {
  foreach ($th in $p.Threads) {
    $name = ''
    $h = [P.T]::OpenThread(0x0800, $false, $th.Id)
    if ($h -ne [IntPtr]::Zero) {
      $d = [IntPtr]::Zero
      if ([P.T]::GetThreadDescription($h, [ref]$d) -ge 0 -and $d -ne [IntPtr]::Zero) { $name = [Runtime.InteropServices.Marshal]::PtrToStringUni($d); [void][P.T]::LocalFree($d) }
      [void][P.T]::CloseHandle($h)
    }
    try { $ms = [long]$th.TotalProcessorTime.TotalMilliseconds } catch { $ms = 0 }
    '{0}\t{1}\t{2}\t{3}\t{4}' -f $p.Id, $types[$p.Id], $th.Id, $name, $ms
  }
}`;

function snapshot() {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS], { encoding: "utf8", windowsHide: true, maxBuffer: 1 << 24 });
    const m = new Map();
    for (const line of out.split(/\r?\n/).filter(Boolean)) {
        const [pid, type, tid, name, ms] = line.split("\t");
        m.set(`${pid}/${tid}`, { type: type || "?", name: (name || "(unnamed)").replace(/\d+$/, "#"), ms: Number(ms) });
    }
    return m;
}

try {
    await killDiscord(inst);
    if (stock) installStub(inst);
    launchDiscord(inst, { variant: stock ? "stock" : "mod", port: PORT });
    await waitForMainTarget(PORT, 120000);
    await sleep(45000);
    const a = snapshot();
    const t0 = Date.now();
    await sleep(SECONDS * 1000);
    const b = snapshot();
    const wall = Date.now() - t0;

    const groups = new Map();
    for (const [k, t] of b) {
        const key = `${t.type} :: ${t.name}`;
        const g = groups.get(key) ?? { n: 0, pct: 0 };
        g.n++;
        g.pct += ((t.ms - (a.get(k)?.ms ?? 0)) / wall) * 100;
        groups.set(key, g);
    }
    const rows = [...groups].sort((x, y) => y[1].pct - x[1].pct);
    const total = rows.reduce((s, [, g]) => s + g.pct, 0);
    console.log(`${stock ? "STOCK" : "VENCORD"}: ${total.toFixed(2)} % of one core over ${SECONDS} s`);
    for (const [k, g] of rows.filter(([, g]) => g.pct >= 0.05)) console.log(`  ${g.pct.toFixed(2).padStart(6)} %  ${g.n}×  ${k}`);
} finally {
    await killDiscord(inst).catch(() => { });
    if (stock) removeStub(inst);
    relaunchNormally(inst);
}
