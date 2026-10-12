// Tiny Chrome DevTools Protocol client (Node 22 global WebSocket).
import { sleep } from "./discord.mjs";

export async function listTargets(port) {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    return res.json();
}

/** Waits for Discord's main window target (not the splash/updater window). */
export async function waitForMainTarget(port, timeoutMs) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        try {
            const targets = await listTargets(port);
            const main = targets.find(t => t.type === "page" && /^https:\/\/(\w+\.)?discord\.com\//.test(t.url));
            if (main) return main;
        } catch { /* port not open yet */ }
        await sleep(100);
    }
    throw new Error("Timed out waiting for Discord's main window");
}

export class CDP {
    #ws;
    #id = 0;
    #pending = new Map();
    #listeners = new Map();

    static async connect(wsUrl) {
        const c = new CDP();
        c.#ws = new WebSocket(wsUrl);
        await new Promise((res, rej) => {
            c.#ws.addEventListener("open", res, { once: true });
            c.#ws.addEventListener("error", rej, { once: true });
        });
        c.#ws.addEventListener("message", e => c.#onMessage(JSON.parse(e.data)));
        c.#ws.addEventListener("close", () => {
            for (const { rej } of c.#pending.values()) rej(new Error("CDP connection closed"));
            c.#pending.clear();
        });
        return c;
    }

    #onMessage(msg) {
        if (msg.id != null) {
            const p = this.#pending.get(msg.id);
            if (!p) return;
            this.#pending.delete(msg.id);
            if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`));
            else p.res(msg.result);
        } else if (msg.method) {
            for (const fn of this.#listeners.get(msg.method) ?? []) fn(msg.params);
        }
    }

    send(method, params = {}, timeoutMs = 60000) {
        const id = ++this.#id;
        this.#ws.send(JSON.stringify({ id, method, params }));
        return new Promise((res, rej) => {
            const timer = setTimeout(() => {
                this.#pending.delete(id);
                rej(new Error(`${method} timed out`));
            }, timeoutMs);
            this.#pending.set(id, {
                method,
                res: v => { clearTimeout(timer); res(v); },
                rej: e => { clearTimeout(timer); rej(e); },
            });
        });
    }

    on(method, fn) {
        if (!this.#listeners.has(method)) this.#listeners.set(method, []);
        this.#listeners.get(method).push(fn);
    }

    /** Evaluates an expression in the page; awaits promises and returns the value. */
    async eval(expression, timeoutMs = 60000) {
        const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
        if (r.exceptionDetails) {
            throw new Error(`Page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
        }
        return r.result.value;
    }

    async metrics() {
        const { metrics } = await this.send("Performance.getMetrics");
        return Object.fromEntries(metrics.map(m => [m.name, m.value]));
    }

    close() {
        this.#ws.close();
    }
}
