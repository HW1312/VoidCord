import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("../../Vencord/node_modules/typescript");
const workspace = new URL("../../", import.meta.url);

function load(relativePath, modules = {}) {
    const source = readFileSync(new URL(relativePath, workspace), "utf8");
    const code = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            jsx: ts.JsxEmit.React
        }
    }).outputText;
    const context = {
        exports: {},
        require(name) {
            assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
            return modules[name];
        }
    };
    runInNewContext(code, context, { filename: fileURLToPath(new URL(relativePath, workspace)) });
    return context.exports;
}

const { SettingsStore } = load("Vencord/src/shared/SettingsStore.ts");

function fixture() {
    let store;
    const plugin = load("FakeRobux/index.tsx", {
        "@api/Settings": {
            definePluginSettings(definition) {
                store = new SettingsStore({ plugins: { FakeRobux: Object.fromEntries(
                    Object.entries(definition)
                        .filter(([, setting]) => "default" in setting)
                        .map(([key, setting]) => [key, structuredClone(setting.default)])
                ) } });
                // Electron IPC must be able to clone the entire plain settings payload.
                store.addGlobalChangeListener(data => structuredClone(data));
                return {
                    get store() { return store.store.plugins.FakeRobux; },
                    get plain() { return store.plain.plugins.FakeRobux; }
                };
            }
        },
        "@utils/types": { __esModule: true, default: plugin => plugin, OptionType: {} },
        "../_ui": { titleBarSlot: () => () => null },
        "./ui": { renderTitleBarButton: () => null, SettingsPanel: () => null }
    });
    return { plugin, store };
}

const donation = { kind: "donate", amount: 100, userId: 1, username: "tester", displayName: "Tester" };

test("repeated donations remain serializable and return a receipt", () => {
    const { plugin, store } = fixture();
    for (let count = 1; count <= 3; count++) {
        assert.ok(plugin.spend(donation));
        assert.equal(plugin.settings.store.balance, 1000 - count * 100);
        assert.equal(structuredClone(store.plain).plugins.FakeRobux.history.length, count);
    }
});

test("repeated gifts copy nested catalog items before IPC", () => {
    const { plugin, store } = fixture();
    const gift = { ...donation, kind: "gift", item: { id: 2, itemType: "Asset", name: "Hat" } };
    assert.ok(plugin.spend(gift));
    assert.ok(plugin.spend(donation));
    assert.ok(plugin.spend(gift));
    const history = structuredClone(store.plain).plugins.FakeRobux.history;
    assert.equal(history.length, 3);
    assert.equal(history[2].item.name, "Hat");
    assert.equal(plugin.settings.store.balance, 700);
});

test("insufficient balance changes neither balance nor history", () => {
    const { plugin, store } = fixture();
    const before = structuredClone(store.plain);
    assert.equal(plugin.spend({ ...donation, amount: 1001 }), false);
    assert.deepEqual(structuredClone(store.plain), before);
});

test("history retains only the latest 200 serializable receipts", () => {
    const { plugin, store } = fixture();
    plugin.setBalance(30_000);
    for (let count = 0; count < 201; count++) {
        assert.ok(plugin.spend({ ...donation, userId: count + 1 }));
    }
    const history = structuredClone(store.plain).plugins.FakeRobux.history;
    assert.equal(history.length, 200);
    assert.equal(history[0].userId, 201);
    assert.equal(history[199].userId, 2);
    assert.equal(plugin.settings.store.balance, 9900);
});
