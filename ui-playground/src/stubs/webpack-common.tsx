/*
 * Stand-ins for the Discord modules the kit uses (React comes from npm here instead of Discord).
 */

import { cloneElement, isValidElement, type ReactNode, useState as useStateReact } from "react";
import { createRoot } from "react-dom/client";

export { createRoot };
export { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
export { default as React } from "react";
export { default as ReactDOM } from "react-dom";

// ---------------------------------------------------------------- Modals

type ModalRender = (props: { onClose(): void; transitionState: number; }) => ReactNode;

let host: HTMLElement | null = null;
const roots: Array<() => void> = [];

export function openModal(render: ModalRender, opts?: { onCloseCallback?(): void; }) {
    host ??= Object.assign(document.body.appendChild(document.createElement("div")), { className: "pg-modals" });
    const layer = host.appendChild(document.createElement("div"));
    layer.className = "pg-modal-layer";
    const root = createRoot(layer);
    const close = () => {
        root.unmount();
        layer.remove();
        roots.splice(roots.indexOf(close), 1);
        opts?.onCloseCallback?.();
    };
    roots.push(close);
    layer.addEventListener("mousedown", e => { if (e.target === layer) close(); });
    root.render(<>{render({ onClose: close, transitionState: 1 })}</>);
    return String(roots.length);
}

addEventListener("keydown", e => { if (e.key === "Escape") roots.at(-1)?.(); });

// ---------------------------------------------------------------- Tooltip (render prop like Discord's)

export function Tooltip({ text, children }: { text: ReactNode; children(props: Record<string, unknown>): ReactNode; }) {
    const [shown, setShown] = useStateReact<DOMRect | null>(null);
    const el = children({
        onMouseEnter: (e: MouseEvent) => setShown((e.currentTarget as HTMLElement).getBoundingClientRect()),
        onMouseLeave: () => setShown(null)
    });
    return (
        <>
            {el}
            {shown && (
                <div className="pg-tooltip" style={{ left: shown.left + shown.width / 2, top: shown.top - 6 }}>{text}</div>
            )}
        </>
    );
}

// ---------------------------------------------------------------- Rest (only needed so titlebar.tsx loads)

export const ContextMenuApi = { openContextMenu() { }, closeContextMenu() { } };
export const Menu = new Proxy({}, { get: () => ({ children }: { children?: ReactNode; }) => <>{children}</> });
export const showToast = ({ text, variant }: { text: string; variant?: string; }) => console.log("[toast]", variant ?? "default", text);
export const Toasts = { Type: { SUCCESS: "success", FAILURE: "failure", MESSAGE: "message" } };

export { cloneElement, isValidElement };
