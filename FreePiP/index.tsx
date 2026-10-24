/*
 * FreePiP – Vencord Userplugin
 * The small stream window (picture in picture) you get while watching a stream from another channel:
 * - resize it as big as the Discord window allows (Discord stops at 960 px and keeps 80 px from the edges)
 * - drop it anywhere instead of snapping into one of the four corners; the spot is remembered
 * Patches Discord's PiP window class (getPosition / handleDragStart / handleDragEnd) and the resize config it gets.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";

import { Button } from "../_ui";

/** Where the window was dropped: share of the free space (0 = left / top, 1 = right / bottom) */
interface Spot { x: number; y: number; }

/** Gap to the window edges with no size limit (Discord: 80, bottom 132) */
const EDGE = 12;
/** Top gap, so the window can't slide under the title bar */
const EDGE_TOP = 40;

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** Free area for the window's top-left corner along one axis: [start, start + length] */
const span = (start: number, max: number, size: number, end: number) => ({ start, length: Math.max(0, max - size - end - start) });

const logger = new Logger("FreePiP");

/** The PiP window being dragged (its class instance) */
let dragWin: any = null;
/** Discord's drag layer: covers the whole window with a grabbing cursor and takes every click while it's there */
const DRAG_LAYER = '[class*="pictureInPicture_"][class*="dragging_"]';

/**
 * Safety net: the mouse moves with no button held, but the drag layer is still there (the drop got lost, e.g. while
 * you stream yourself) – end the drag like Discord would, so you can click again.
 */
function unstick(e: MouseEvent) {
    if (!dragWin || e.buttons !== 0 || !document.querySelector(DRAG_LAYER)) return;
    const win = dragWin;
    dragWin = null;
    try {
        const drag = win._draggable;
        drag?._removeListeners?.();
        if (drag?.state?.dragging) drag.setState({ dragging: false });
        win.props.onDragEnd?.(e.clientX, e.clientY);
        logger.info("Ended a stuck drag of the stream window");
    } catch (err) {
        logger.error("Could not end the stuck drag", err);
    }
}

const settings = definePluginSettings({
    unlimitedSize: {
        type: OptionType.BOOLEAN,
        description: "No size limit – drag a corner of the stream window as big as the Discord window",
        default: true
    },
    freePosition: {
        type: OptionType.BOOLEAN,
        description: "Place the stream window anywhere – no snapping into a corner",
        default: true
    },
    spot: {
        type: OptionType.CUSTOM,
        default: null as Spot | null,
        hidden: true
    },
    reset: {
        type: OptionType.COMPONENT,
        component: () => (
            <Button small variant="gray" onClick={() => { settings.store.spot = null; }}>
                Put the stream window back in its corner
            </Button>
        )
    }
});

export default definePlugin({
    name: "FreePiP",
    description: "The small stream window while you're in another channel: no size limit, and it stays exactly where you drop it",
    authors: [{ name: "5406", id: 1062070744558870548n }],
    tags: ["Media", "Voice"],
    settings,

    patches: [
        {
            find: "top:80,bottom:132,left:80,right:80",
            replacement: [
                {
                    // Min / max width of the video window (Discord: 200 – 960 px)
                    match: /resizeConfig:(\i\|\|\i\?void 0:)(\i)/,
                    replace: "resizeConfig:$1$self.resizeConfig($2)"
                },
                {
                    // Gaps to the edges: they also cap the width (window width − left − right)
                    // Discord keeps them in a constant object; getters so the setting applies without a restart
                    match: /\{top:80,bottom:132,left:80,right:80\}/,
                    replace: "{get top(){return $self.edge(80,true)},get bottom(){return $self.edge(132)},get left(){return $self.edge(80)},get right(){return $self.edge(80)}}"
                },
                {
                    // Remember which window is dragged, so a stuck drag can be ended (see unstick)
                    match: /handleDragStart=\(\i,\i\)=>\{/,
                    replace: "$&$self.dragStart(this);"
                },
                {
                    // Dropped: remember the spot instead of flying into the nearest corner
                    match: /handleDragEnd=\((\i),(\i)\)=>\{/,
                    replace: "$&if($self.drop(this,$1,$2))return;"
                },
                {
                    // Position of the window: the remembered spot before the corner positions
                    match: /(getPosition\(\i\)\{.{0,300}?maxX:(\i),maxY:(\i),.{0,300}?if\(null!=\i\)return\{[^}]+\};)/,
                    replace: "$1{const vcSpot=$self.position($2,$3,this._boundWidth,this._boundHeight);if(vcSpot)return vcSpot;}"
                }
            ]
        }
    ],

    resizeConfig(config: { minWidth: number; maxWidth: number; } | undefined) {
        if (!config || !settings.store.unlimitedSize) return config;
        // As wide as the Discord window – but the 16:9 picture must still fit its height
        const byWidth = window.innerWidth - 2 * EDGE;
        const byHeight = (window.innerHeight - EDGE_TOP - EDGE) * 16 / 9;
        return { ...config, maxWidth: Math.max(config.maxWidth, Math.floor(Math.min(byWidth, byHeight))) };
    },

    edge(discord: number, top?: boolean) {
        return settings.store.unlimitedSize ? (top ? EDGE_TOP : EDGE) : discord;
    },

    start() {
        window.addEventListener("mousemove", unstick, true);
    },

    stop() {
        window.removeEventListener("mousemove", unstick, true);
        dragWin = null;
    },

    dragStart(win: any) {
        dragWin = win;
    },

    /** mouseX / mouseY: the Draggable reports where the MOUSE was released, not where the window is */
    drop(win: any, mouseX: number, mouseY: number) {
        if (!settings.store.freePosition) return false;
        try {
            this.place(win, mouseX, mouseY);
        } catch (e) {
            logger.error("Could not place the stream window, it snaps into a corner instead", e);
            return false;
        }
        // Ends Discord's drag state (a full-screen layer that catches every click) – must always run
        win.props.onDragEnd?.(mouseX, mouseY);
        return true;
    },

    place(win: any, mouseX: number, mouseY: number) {
        const { maxX, maxY } = win.props;
        const drag = win._draggable;
        const rect = win._innerDivRef?.current?.getBoundingClientRect?.();
        const width = rect?.width ?? win._boundWidth, height = rect?.height ?? win._boundHeight;
        // Top-left corner of the window = mouse minus where the window was grabbed (as the Draggable moves it)
        const x = mouseX - (drag?._offsetX ?? 0), y = mouseY - (drag?._offsetY ?? 0);
        const h = span(EDGE, maxX, width, EDGE), v = span(EDGE_TOP, maxY, height, EDGE);
        settings.store.spot = {
            x: clamp01((x - h.start) / Math.max(1, h.length)),
            y: clamp01((y - v.start) / Math.max(1, v.length))
        };
        win.ensureIsInPosition();
    },

    position(maxX: number, maxY: number, width: number, height: number) {
        const { spot } = settings.store;
        if (!settings.store.freePosition || !spot) return null;
        const h = span(EDGE, maxX, width, EDGE), v = span(EDGE_TOP, maxY, height, EDGE);
        return {
            x: Math.round(h.start + clamp01(spot.x) * h.length),
            y: Math.round(v.start + clamp01(spot.y) * v.length)
        };
    }
});
