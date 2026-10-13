import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const puppeteer = require("../../Vencord/node_modules/puppeteer-core");

test("viewer buttons receive clicks inside a non-interactive modal layer", async () => {
    const browser = await puppeteer.launch({
        executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        headless: true,
        timeout: 15000
    });
    try {
        const page = await browser.newPage();
        await page.bringToFront();
        await page.setViewport({ width: 1000, height: 700 });
        const css = readFileSync(new URL("../ui.css", import.meta.url), "utf8");
        await page.setContent(`
            <style>body { margin: 0; } .modal-layer { pointer-events: none; } ${css}</style>
            <div class="modal-layer">
                <div class="vc-secretchat-viewer">
                    <div style="width: 800px; height: 450px; background: #123" aria-label="Media"></div>
                    <div class="vc-secretchat-viewer-bar">
                        <span class="vc-secretchat-viewer-name">picture.png</span>
                        <button class="vc-secretchat-viewer-btn" id="save">Save</button>
                        <button class="vc-secretchat-viewer-btn" id="close">Close</button>
                    </div>
                </div>
            </div>
            <script>
                window.saved = 0;
                document.getElementById('save').onclick = () => window.saved++;
                document.getElementById('close').onclick = () => document.querySelector('.vc-secretchat-viewer').remove();
            </script>`);
        // Reproduce the previous inherited pointer-events state before checking the actual stylesheet.
        await page.$eval(".vc-secretchat-viewer", el => el.style.pointerEvents = "none");
        await page.click("#save");
        assert.equal(await page.evaluate(() => window.saved), 0, "inherited none blocks the handler");
        await page.$eval(".vc-secretchat-viewer", el => el.style.removeProperty("pointer-events"));
        const hit = await page.$eval("#save", el => {
            const rect = el.getBoundingClientRect();
            return {
                pointerEvents: getComputedStyle(el).pointerEvents,
                target: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.id
            };
        });
        assert.equal(hit.pointerEvents, "auto");
        assert.equal(hit.target, "save", "the button must be the actual hit target");
        await page.click("#save");
        assert.equal(await page.evaluate(() => window.saved), 1, "Save must receive the click");
        await page.click("#close");
        assert.equal(await page.$(".vc-secretchat-viewer"), null, "Close must dismiss the viewer");
    } finally {
        await browser.close();
    }
});
