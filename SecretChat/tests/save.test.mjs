import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { win32 } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("../../Vencord/node_modules/typescript");

function load(file, modules, globals = {}) {
    const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const context = { exports: {}, Uint8Array, ...globals, require(name) {
        assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
        return modules[name];
    } };
    runInNewContext(code, context);
    return context.exports;
}

function nativeFixture(result = { canceled: false, filePath: "C:\\Downloads\\picture.png" }, failure) {
    const writes = [];
    const dialogs = [];
    const parent = {};
    const native = load("native.ts", {
        electron: {
            BrowserWindow: { fromWebContents: () => parent },
            dialog: { async showSaveDialog(owner, options) { dialogs.push({ owner, options }); return result; } }
        },
        "fs/promises": { async writeFile(path, bytes) {
            if (failure) throw failure;
            writes.push({ path, bytes });
        } },
        https: {},
        path: win32
    });
    return { native, writes, dialogs, parent };
}

test("desktop saver preserves bytes and writes only to the chosen path", async () => {
    const { native, writes, dialogs, parent } = nativeFixture();
    const bytes = new Uint8Array([0, 255, 128, 42]);
    assert.equal(await native.save({ sender: {} }, bytes, "..\\elsewhere\\picture.png"), true);
    assert.equal(dialogs[0].owner, parent);
    assert.equal(dialogs[0].options.defaultPath, "picture.png");
    assert.deepEqual(writes, [{ path: "C:\\Downloads\\picture.png", bytes }]);
});

test("cancelled dialog never writes a decrypted file", async () => {
    const { native, writes } = nativeFixture({ canceled: true, filePath: "C:\\unused.png" });
    assert.equal(await native.save({ sender: {} }, new Uint8Array([1]), "picture.png"), false);
    assert.equal(writes.length, 0);
});

test("disk failures are rejected and invalid input never opens a dialog", async () => {
    const { native, dialogs } = nativeFixture(undefined, new Error("Disk full"));
    await assert.rejects(native.save({ sender: {} }, new Uint8Array([1]), "picture.png"), /Disk full/);
    await assert.rejects(native.save({ sender: {} }, [1], "picture.png"), /Invalid file/);
    assert.equal(dialogs.length, 1);
});

class Element {
    children = [];
    dataset = {};
    attributes = {};
    constructor(tag) { this.tag = tag; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    appendChild(child) { child.parent = this; this.children.push(child); }
    setAttribute(name, value) { this.attributes[name] = value; }
    get childElementCount() { return this.children.length; }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    click() { this.clicked = true; }
}

function rendererFixture({ desktop = true, save = async () => true, fetchFailure, ok = true } = {}) {
    const body = new Element("body");
    const created = [];
    const timers = [];
    const calls = [];
    const document = {
        body,
        querySelector: selector => body.children.find(child => `.${child.className}` === selector),
        createElement: tag => { const el = new Element(tag); created.push(el); return el; }
    };
    const module = load("save.ts", {
        "@utils/Logger": { Logger: class { error() {} } }
    }, {
        document,
        IS_DISCORD_DESKTOP: desktop,
        VencordNative: { pluginHelpers: { "Unter das OS": save ? { save: async (...args) => { calls.push(args); return save(...args); } } : {} } },
        fetch: async () => {
            if (fetchFailure) throw fetchFailure;
            return { ok, status: 404, arrayBuffer: async () => new Uint8Array([0, 255, 128]).buffer };
        },
        setTimeout: (callback, delay) => timers.push({ callback, delay })
    });
    const cards = () => created.filter(el => el.className === "vc-secretchat-download-card");
    return { ...module, body, created, timers, calls, cards };
}

test("save shows immediate feedback, suppresses repeated clicks and confirms completion", async () => {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const fixture = rendererFixture({ save: () => pending });
    const first = fixture.saveDecrypted("blob:picture", "picture.png");
    assert.equal(fixture.cards()[0].children[1].textContent, "Preparing to save…");
    assert.equal(fixture.cards()[0].children[2].value, undefined, "no invented percentage");
    await fixture.saveDecrypted("blob:picture", "picture.png");
    assert.equal(fixture.cards().length, 1);
    finish(true);
    await first;
    assert.equal(fixture.calls.length, 1);
    assert.deepEqual(Array.from(fixture.calls[0][0]), [0, 255, 128]);
    assert.equal(fixture.cards()[0].dataset.state, "done");
    assert.equal(fixture.cards()[0].children[1].textContent, "File saved");
    fixture.timers[0].callback();
    assert.equal(fixture.body.childElementCount, 0, "completed card and empty stack removed");
});

test("cancellation is distinct from successful saving and allows a retry", async () => {
    const fixture = rendererFixture({ save: async () => false });
    await fixture.saveDecrypted("blob:picture", "picture.png");
    assert.equal(fixture.cards()[0].dataset.state, "cancelled");
    assert.equal(fixture.cards()[0].children[1].textContent, "Save cancelled");
    await fixture.saveDecrypted("blob:picture", "picture.png");
    assert.equal(fixture.calls.length, 2);
});

test("write errors, unreadable blobs and a stale native helper show a failure", async () => {
    for (const [options, message] of [
        [{ save: async () => { throw new Error("Disk full"); } }, /Disk full/],
        [{ fetchFailure: new Error("Blob revoked") }, /Blob revoked/],
        [{ ok: false }, /404/],
        [{ save: null }, /Restart Discord/]
    ]) {
        const fixture = rendererFixture(options);
        await fixture.saveDecrypted("blob:picture", "picture.png");
        assert.equal(fixture.cards()[0].dataset.state, "error");
        assert.match(fixture.cards()[0].children[1].textContent, message);
        assert.equal(fixture.created.filter(el => el.tag === "a").length, 0, "no silent desktop fallback");
    }
});

test("browser download hands off the original blob and does not claim a disk write", async () => {
    const fixture = rendererFixture({ desktop: false });
    await fixture.saveDecrypted("blob:picture", "<picture>.png");
    const anchor = fixture.created.find(el => el.tag === "a");
    assert.equal(anchor.href, "blob:picture");
    assert.equal(anchor.download, "<picture>.png");
    assert.equal(anchor.clicked, true);
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.cards()[0].children[1].textContent, "Download handed to your browser");
    assert.equal(fixture.cards()[0].children[0].textContent, "<picture>.png");
});
