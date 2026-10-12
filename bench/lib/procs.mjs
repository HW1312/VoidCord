// Samples every process of one Discord branch once per second with a long-running PowerShell.
// Private bytes = commit charge (what really costs RAM), not the working set that RAM "limiters" trim.
import { spawn } from "child_process";

const SCRIPT = name => `
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $p = @(Get-Process -Name '${name}' | ForEach-Object {
    '{0},{1},{2},{3}' -f $_.Id, $_.PrivateMemorySize64, $_.WorkingSet64, [long]$_.TotalProcessorTime.TotalMilliseconds
  })
  [Console]::Out.WriteLine("$t;" + ($p -join '|'))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1000
}`;

export class ProcSampler {
    samples = [];
    #ps;

    constructor(processName) {
        this.#ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SCRIPT(processName)], {
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
        });
        let buf = "";
        this.#ps.stdout.on("data", d => {
            buf += d;
            let i;
            while ((i = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                const [t, list] = line.split(";");
                if (!t) continue;
                const procs = (list ? list.split("|") : []).map(s => {
                    const [pid, priv, ws, cpu] = s.split(",").map(Number);
                    return { pid, priv, ws, cpu };
                });
                this.samples.push({ t: Number(t), procs });
            }
        });
    }

    /** Resolves once a sample newer than `since` exists. */
    async waitForSample(since = Date.now()) {
        while (!this.samples.some(s => s.t > since)) await new Promise(r => setTimeout(r, 100));
    }

    between(from, to) {
        return this.samples.filter(s => s.t >= from && s.t <= to && s.procs.length);
    }

    stop() {
        this.#ps.kill();
    }
}

export function totals(sample) {
    let priv = 0, ws = 0;
    for (const p of sample.procs) {
        priv += p.priv;
        ws += p.ws;
    }
    return { priv, ws, count: sample.procs.length };
}

/** CPU milliseconds used by the process tree between two samples (new processes count fully). */
export function cpuDelta(a, b) {
    const before = new Map(a.procs.map(p => [p.pid, p.cpu]));
    let ms = 0;
    for (const p of b.procs) ms += p.cpu - (before.get(p.pid) ?? 0);
    return ms;
}
