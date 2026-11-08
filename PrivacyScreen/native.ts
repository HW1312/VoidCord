/*
 * PrivacyScreen – runs in the Electron main process
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, IpcMainInvokeEvent } from "electron";

/**
 * Capture protection: the Discord window appears blank/black in screenshots, screen recordings and
 * screen shares (including "entire screen").
 * Windows 10 (2004+) / Windows 11 / macOS.
 */
export function setContentProtection(event: IpcMainInvokeEvent, enabled: boolean) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return false;
    win.setContentProtection(enabled);
    return true;
}
