/*
 * Discord modal look-alike: backdrop + root box with Discord's size widths and height cap,
 * so window layout bugs (clipped footers …) show up here too.
 */

import type { ReactNode } from "react";

export enum ModalSize {
    SMALL = "small",
    MEDIUM = "medium",
    LARGE = "large",
    DYNAMIC = "dynamic"
}

const WIDTH: Record<ModalSize, number | undefined> = { small: 440, medium: 600, large: 800, dynamic: undefined };

export function ModalRoot({ children, size = ModalSize.SMALL, className }: { children?: ReactNode; size?: ModalSize; className?: string; }) {
    return (
        <div
            className={`pg-modal-root ${className ?? ""}`}
            style={{ width: WIDTH[size], minHeight: size === ModalSize.SMALL ? 200 : 400 }}
            onClick={e => e.stopPropagation()}
        >
            {children}
        </div>
    );
}
