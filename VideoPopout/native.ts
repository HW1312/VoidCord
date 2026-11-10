/*
 * VideoPopout – runs in the Electron main process
 * Discord's popout window with our player is found by its content (Discord keeps popout titles fixed, so the
 * title can't be used). Here it gets what makes it feel like picture-in-picture:
 *  - the video's exact shape (content size + locked aspect ratio – no black bars, also while resizing)
 *  - "always on top" over every program on every monitor (Discord's own pin only keeps it above Discord)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, IpcMainInvokeEvent, screen } from "electron";

const MARKER = "document.querySelector('.vc-videopopout-window') !== null";

/** Asks every window at once; a window that never answers (hidden helper windows, a page still loading) gives up after 800 ms instead of blocking the search */
async function find() {
    const checks = BrowserWindow.getAllWindows().map(async w => {
        if (w.isDestroyed()) return null;
        try {
            const hit = await Promise.race([
                w.webContents.executeJavaScript(MARKER, false),
                new Promise(r => setTimeout(() => r(false), 800))
            ]);
            return hit === true ? w : null;
        } catch { return null; }
    });
    return (await Promise.all(checks)).find(w => w && !w.isDestroyed()) ?? null;
}

/** ratio = width / height of the video. Always on top, every time. */
export async function shape(_: IpcMainInvokeEvent, ratio: number) {
    const win = await find();
    if (!win) return false;
    if (ratio > 0.1 && ratio < 10) {
        const area = screen.getDisplayMatching(win.getBounds()).workArea;
        // Landscape 560 wide, portrait 560 high – never bigger than 80 % of the screen
        let w = ratio >= 1 ? 560 : Math.round(560 * ratio);
        let h = Math.round(w / ratio);
        const scale = Math.min(1, (area.width * 0.8) / w, (area.height * 0.8) / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        win.setAspectRatio(0);
        win.setMinimumSize(Math.min(120, w), Math.min(120, h));
        win.setContentSize(w, h);
        win.setAspectRatio(ratio);
        // Bottom right of the screen it is on, like picture-in-picture
        const b = win.getBounds();
        win.setPosition(area.x + area.width - b.width - 24, area.y + area.height - b.height - 24);
    }
    win.setAlwaysOnTop(true, "screen-saver");
    return true;
}
