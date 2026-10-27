/*
 * OpSec – Image editor before upload (UploadEditor)
 * Crop, pixelate, blur, redact, pen, arrow, text – with undo/redo.
 * All steps are stored as a list and re-applied to the original on every change
 * (saves memory compared to an image copy per step). The result is re-encoded via a canvas –
 * which automatically drops all metadata.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { useEffect, useLayoutEffect, useRef, useState } from "@webpack/common";
import type { PointerEvent as ReactPointerEvent } from "react";

import { confirm, Icon, ICONS, openWindow, Sheet, strokeIcon, TextField } from "../_ui";
import { OPSEC_COLOR, opsecNotify, Tip } from "./ui";

const cl = classNameFactory("vc-opsec-");

const EDITABLE = /^image\/(png|jpeg|webp)$/;

/** Still images only (PNG/JPEG/WebP) – GIFs & videos would lose their animation */
export function isEditableImage(file: File, name = file.name) {
    if (EDITABLE.test(file.type)) return true;
    return !file.type && /\.(png|jpe?g|webp)$/i.test(name);
}

// ---------------------------------------------------------------- Steps

type Rect = { x: number; y: number; w: number; h: number; };

type Op =
    | ({ t: "crop" | "pixelate" | "blur" | "box"; } & Rect)
    | { t: "pen"; pts: number[]; color: string; size: number; }
    | { t: "arrow"; x1: number; y1: number; x2: number; y2: number; color: string; size: number; }
    | { t: "text"; x: number; y: number; text: string; color: string; size: number; };

type Tool = "crop" | "pixelate" | "blur" | "box" | "pen" | "arrow" | "text";

const TOOLS: { id: Tool; label: string; icon: string; }[] = [
    { id: "crop", label: "Crop", icon: strokeIcon("M6 2v14a2 2 0 0 0 2 2h14", "M18 22V8a2 2 0 0 0-2-2H2") },
    { id: "box", label: "Redact", icon: strokeIcon("M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z") },
    { id: "pixelate", label: "Pixelate", icon: strokeIcon("M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M3 9h18", "M3 15h18", "M9 3v18", "M15 3v18") },
    { id: "blur", label: "Blur", icon: strokeIcon("M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z") },
    { id: "pen", label: "Pen", icon: ICONS.edit },
    { id: "arrow", label: "Arrow", icon: strokeIcon("M7 7h10v10", "M7 17 17 7") },
    { id: "text", label: "Text", icon: strokeIcon("M12 4v16", "M4 7V4h16v3", "M9 20h6") }
];

/** Header / prompt icon (brush) */
const ERASER_ICON = strokeIcon("m11 10 3 3", "M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z", "M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031");

const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#000000"];

function normRect(x1: number, y1: number, x2: number, y2: number): Rect {
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function clampRect(r: Rect, w: number, h: number): Rect | null {
    const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
    const x2 = Math.min(w, Math.round(r.x + r.w)), y2 = Math.min(h, Math.round(r.y + r.h));
    return x2 - x >= 2 && y2 - y >= 2 ? { x, y, w: x2 - x, h: y2 - y } : null;
}

function drawArrow(ctx: CanvasRenderingContext2D, op: Extract<Op, { t: "arrow"; }>) {
    const { x1, y1, x2, y2, size } = op;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = size * 4;
    ctx.strokeStyle = ctx.fillStyle = op.color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - Math.cos(angle) * head * 0.8, y2 - Math.sin(angle) * head * 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
}

function drawPen(ctx: CanvasRenderingContext2D, op: Extract<Op, { t: "pen"; }>) {
    const { pts } = op;
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.size;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    if (pts.length === 2) ctx.lineTo(pts[0] + 0.1, pts[1]);
    ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, op: Extract<Op, { t: "text"; }>) {
    ctx.font = `700 ${op.size}px "gg sans", "Noto Sans", sans-serif`;
    ctx.textBaseline = "top";
    // Outline so text is readable on any background
    ctx.lineWidth = Math.max(2, op.size / 8);
    ctx.strokeStyle = op.color === "#000000" ? "#fff" : "#000";
    ctx.lineJoin = "round";
    ctx.strokeText(op.text, op.x, op.y);
    ctx.fillStyle = op.color;
    ctx.fillText(op.text, op.x, op.y);
}

/** Applies all steps to the original and returns the result at full resolution */
function render(source: ImageBitmap, ops: Op[]): HTMLCanvasElement {
    let canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    let ctx = canvas.getContext("2d")!;
    ctx.drawImage(source, 0, 0);

    for (const op of ops) {
        ctx.save();
        switch (op.t) {
            case "crop": {
                const r = clampRect(op, canvas.width, canvas.height);
                if (!r) break;
                const next = document.createElement("canvas");
                next.width = r.w;
                next.height = r.h;
                next.getContext("2d")!.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
                canvas = next;
                ctx.restore();
                ctx = canvas.getContext("2d")!;
                ctx.save();
                break;
            }
            case "box": {
                const r = clampRect(op, canvas.width, canvas.height);
                if (!r) break;
                ctx.fillStyle = "#000";
                ctx.fillRect(r.x, r.y, r.w, r.h);
                break;
            }
            case "pixelate": {
                const r = clampRect(op, canvas.width, canvas.height);
                if (!r) break;
                // Coarse blocks (~1/40 of the image size) plus slight noise to prevent reverse-engineering
                const block = Math.max(8, Math.round(Math.max(canvas.width, canvas.height) / 40));
                const sw = Math.max(1, Math.ceil(r.w / block)), sh = Math.max(1, Math.ceil(r.h / block));
                const small = document.createElement("canvas");
                small.width = sw;
                small.height = sh;
                const sctx = small.getContext("2d")!;
                sctx.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
                const data = sctx.getImageData(0, 0, sw, sh);
                for (let i = 0; i < data.data.length; i += 4) {
                    const n = (Math.random() - 0.5) * 24;
                    data.data[i] += n;
                    data.data[i + 1] += n;
                    data.data[i + 2] += n;
                }
                sctx.putImageData(data, 0, 0);
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(small, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
                break;
            }
            case "blur": {
                const r = clampRect(op, canvas.width, canvas.height);
                if (!r) break;
                const radius = Math.max(6, Math.round(Math.max(canvas.width, canvas.height) / 80));
                const copy = document.createElement("canvas");
                copy.width = r.w;
                copy.height = r.h;
                copy.getContext("2d")!.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
                ctx.beginPath();
                ctx.rect(r.x, r.y, r.w, r.h);
                ctx.clip();
                ctx.filter = `blur(${radius}px)`;
                // Draw multiple times so the edges are also opaquely blurred
                for (let i = 0; i < 3; i++) ctx.drawImage(copy, r.x, r.y);
                break;
            }
            case "pen":
                drawPen(ctx, op);
                break;
            case "arrow":
                drawArrow(ctx, op);
                break;
            case "text":
                drawText(ctx, op);
                break;
        }
        ctx.restore();
    }
    return canvas;
}

// ---------------------------------------------------------------- Interface

function ToolIcon({ d }: { d: string; }) {
    return <Icon path={d} size={18} />;
}

const UNDO = strokeIcon("M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11");
const REDO = strokeIcon("m15 14 5-5-5-5", "M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13");

interface EditorProps {
    source: ImageBitmap;
    ops: Op[];
    setOps(ops: Op[]): void;
    redo: Op[];
    setRedo(ops: Op[]): void;
}

function EditorCanvas({ source, ops, setOps, redo, setRedo }: EditorProps) {
    const wrap = useRef<HTMLDivElement>(null);
    const view = useRef<HTMLCanvasElement>(null);
    const result = useRef<HTMLCanvasElement | null>(null);
    const [tool, setTool] = useState<Tool>("box");
    const [color, setColor] = useState(COLORS[0]);
    const [text, setText] = useState("");
    const [box, setBox] = useState({ w: 0, h: 0 });
    const [draft, setDraft] = useState<Op | null>(null);
    const start = useRef<{ x: number; y: number; } | null>(null);

    // Only recompute the full-size result when the steps change
    const [version, setVersion] = useState(0);
    useLayoutEffect(() => {
        result.current = render(source, ops);
        setVersion(v => v + 1);
    }, [source, ops]);

    // Zoom-to-fit: measure available space in the modal
    useLayoutEffect(() => {
        const el = wrap.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const img = result.current;
    const scale = img && box.w && box.h ? Math.min(box.w / img.width, box.h / img.height, 1) : 1;
    const baseSize = img ? Math.max(3, Math.round(Math.max(img.width, img.height) / 250)) : 4;

    // Draw the view (result + draft)
    useEffect(() => {
        const c = view.current;
        if (!c || !img) return;
        const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
        const dpr = window.devicePixelRatio || 1;
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
        const ctx = c.getContext("2d")!;
        ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0);
        if (!draft) return;

        ctx.save();
        if (draft.t === "pen") drawPen(ctx, draft);
        else if (draft.t === "arrow") drawArrow(ctx, draft);
        else if (draft.t !== "text") {
            if (draft.t === "crop") {
                // Darken the outside area
                ctx.fillStyle = "rgb(0 0 0 / 55%)";
                ctx.beginPath();
                ctx.rect(0, 0, img.width, img.height);
                ctx.rect(draft.x, draft.y, draft.w, draft.h);
                ctx.fill("evenodd");
            } else {
                ctx.fillStyle = draft.t === "box" ? "rgb(0 0 0 / 85%)" : "rgb(244 245 246 / 18%)";
                ctx.fillRect(draft.x, draft.y, draft.w, draft.h);
            }
            ctx.setLineDash([6 / scale, 4 / scale]);
            ctx.lineWidth = 1.5 / scale;
            ctx.strokeStyle = "#fff";
            ctx.strokeRect(draft.x, draft.y, draft.w, draft.h);
        }
        ctx.restore();
    }, [version, scale, draft]);

    const commit = (op: Op) => {
        setOps([...ops, op]);
        setRedo([]);
    };

    const undo = () => {
        if (!ops.length) return;
        setRedo([...redo, ops[ops.length - 1]]);
        setOps(ops.slice(0, -1));
    };

    const redoOne = () => {
        if (!redo.length) return;
        setOps([...ops, redo[redo.length - 1]]);
        setRedo(redo.slice(0, -1));
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement)?.tagName === "INPUT") return;
            const k = e.key.toLowerCase();
            if (k === "z" && !e.shiftKey) undo();
            else if (k === "y" || (k === "z" && e.shiftKey)) redoOne();
            else return;
            e.preventDefault();
            e.stopPropagation();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    });

    const toImage = (e: ReactPointerEvent) => {
        const r = view.current!.getBoundingClientRect();
        return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
    };

    const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        if (e.button !== 0 || !img) return;
        const p = toImage(e);
        if (tool === "text") {
            if (text.trim()) commit({ t: "text", x: p.x, y: p.y, text: text.trim(), color, size: baseSize * 6 });
            return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = p;
        if (tool === "pen") setDraft({ t: "pen", pts: [p.x, p.y], color, size: baseSize });
        else if (tool === "arrow") setDraft({ t: "arrow", x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, size: baseSize });
        else setDraft({ t: tool, x: p.x, y: p.y, w: 0, h: 0 });
    };

    const onMove = (e: ReactPointerEvent) => {
        const s = start.current;
        if (!s || !draft) return;
        const p = toImage(e);
        if (draft.t === "pen") setDraft({ ...draft, pts: [...draft.pts, p.x, p.y] });
        else if (draft.t === "arrow") setDraft({ ...draft, x2: p.x, y2: p.y });
        else if (draft.t !== "text") setDraft({ ...draft, ...normRect(s.x, s.y, p.x, p.y) });
    };

    const onUp = () => {
        const d = draft;
        start.current = null;
        setDraft(null);
        if (!d || !img) return;
        if (d.t === "pen") return commit(d);
        if (d.t === "arrow") {
            if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > baseSize * 3) commit(d);
            return;
        }
        if (d.t === "text") return;
        const r = clampRect(d, img.width, img.height);
        if (r) commit({ ...d, ...r });
    };

    const needsColor = tool === "pen" || tool === "arrow" || tool === "text";

    return (
        <div className={classes(cl("editor"), cl("no-intercept"), "vc-keep-motion")}>
            <div className={cl("editor-bar")}>
                <div className={cl("editor-tools")}>
                    {TOOLS.map(t => (
                        <button
                            key={t.id}
                            className={classes(cl("editor-tool"), tool === t.id && cl("editor-tool-active"))}
                            onClick={() => setTool(t.id)}
                        >
                            <ToolIcon d={t.icon} />
                            <span>{t.label}</span>
                        </button>
                    ))}
                </div>
                <div className={cl("editor-history")}>
                    <Tip text="Undo (Ctrl + Z)"><button className={cl("editor-tool")} disabled={!ops.length} onClick={undo}><ToolIcon d={UNDO} /></button></Tip>
                    <Tip text="Redo (Ctrl + Y)"><button className={cl("editor-tool")} disabled={!redo.length} onClick={redoOne}><ToolIcon d={REDO} /></button></Tip>
                </div>
            </div>

            <div className={cl("editor-options")}>
                {needsColor && (
                    <div className={cl("swatches")}>
                        {COLORS.map(c => (
                            <button key={c} className={classes(cl("swatch"), cl("swatch-small"), color === c && cl("swatch-active"))} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
                        ))}
                    </div>
                )}
                {tool === "text" && (
                    <div className={cl("editor-text")}>
                        <TextField value={text} maxLength={120} placeholder="Enter text, then click on the image" onChange={setText} />
                    </div>
                )}
                <span className={cl("hint")}>
                    {tool === "crop" && "Drag out the area to keep."}
                    {tool === "box" && "Safest method for names, passwords, addresses & tokens."}
                    {tool === "pixelate" && "Coarse blocks. For text use Redact instead – pixelated content can sometimes be reconstructed."}
                    {tool === "blur" && "Soft blur. For text use Redact instead."}
                    {tool === "pen" && "Draw freehand."}
                    {tool === "arrow" && "Drag from the start to the tip."}
                </span>
            </div>

            <div className={cl("editor-stage")} ref={wrap}>
                <canvas
                    ref={view}
                    className={classes(cl("editor-canvas"), tool === "text" && cl("editor-canvas-text"))}
                    onPointerDown={onDown}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                />
            </div>
            {img && <div className={cl("editor-size")}>{img.width} × {img.height} px</div>}
        </div>
    );
}

// ---------------------------------------------------------------- Opening

function toBlob(canvas: HTMLCanvasElement, type: string) {
    return new Promise<Blob | null>(r => canvas.toBlob(r, type, 0.92));
}

/**
 * Opens the editor. Result: new file (same name & type, without metadata) or null = send the original.
 */
export async function editImage(file: File, name = file.name): Promise<File | null> {
    const source = await createImageBitmap(file);
    const type = EDITABLE.test(file.type) ? file.type : "image/png";

    return new Promise<File | null>(resolve => {
        let done = false;
        const finish = (f: File | null) => {
            if (done) return;
            done = true;
            source.close();
            resolve(f);
        };

        function EditorWindow({ close }: { close(): void; }) {
            const [ops, setOps] = useState<Op[]>([]);
            const [redo, setRedo] = useState<Op[]>([]);
            const [busy, setBusy] = useState(false);

            // Closed by Esc / click outside = send the original
            useEffect(() => () => finish(null), []);

            const apply = async () => {
                if (!ops.length) {
                    finish(null);
                    return close();
                }
                setBusy(true);
                const blob = await toBlob(render(source, ops), type).catch(() => null);
                if (!blob) {
                    // Don't silently send the unredacted original
                    setBusy(false);
                    opsecNotify("OpSec: Failed to save image. Try again or \"Send original\".", "error");
                    return;
                }
                finish(new File([blob], name, { type: blob.type || type, lastModified: Date.now() }));
                close();
            };

            return (
                <Sheet
                    header={{ app: "OpSec", title: "Edit image", subtitle: name, icon: ERASER_ICON, iconColor: OPSEC_COLOR }}
                    onClose={() => { finish(null); close(); }}
                    actions={[
                        { label: "Send original", onClick: () => { finish(null); close(); } },
                        { label: busy ? "Saving…" : "Apply", disabled: busy, onClick: apply }
                    ]}
                >
                    <ErrorBoundary>
                        <EditorCanvas source={source} ops={ops} setOps={setOps} redo={redo} setRedo={setRedo} />
                    </ErrorBoundary>
                </Sheet>
            );
        }

        openWindow(close => <EditorWindow close={close} />, { size: "large", className: cl("editor-window") });
    });
}

/** Small prompt "Edit image?" – true = open the editor */
export function askEdit(name: string, count: number): Promise<boolean> {
    return new Promise(resolve => {
        let done = false;
        const finish = (v: boolean) => {
            if (!done) {
                done = true;
                resolve(v);
            }
        };
        confirm({
            title: "Edit image?",
            icon: ERASER_ICON,
            body: (
                <div className={classes(cl("link-warning"), "vc-keep-motion")}>
                    <div className={cl("hint")}>
                        {count > 1 ? `${count} images were added. ` : ""}Crop or redact names, addresses & tokens before uploading?
                    </div>
                    <div className={cl("link-host")}>{name}</div>
                </div>
            ),
            confirmText: "Edit",
            cancelText: "Keep original"
        }).then(finish, () => finish(false));
    });
}
