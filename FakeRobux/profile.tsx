/*
 * FakeRobux – a Roblox profile page (yours in the Profile tab, others' in Send) with the 3D avatar viewer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { Button, classes, ICONS, Section, Spinner } from "../_ui";
import { avatar3d, getCounts, getRobloxBadges, image, profileUrl, RobloxBadge, RobloxUser } from "./api";
import { abbr, fmt, fmtDate, RobuxIcon, useAsync, UserAvatar, Verified } from "./components";
import { settings } from "./index";
import { AvatarRenderer, View } from "./viewer3d";

const openUrl = (url: string) => VencordNative.native.openExternal(url);

// ---------------------------------------------------------------- Avatar

const MAX_TURN = 40;
const MAX_TILT = 12;

/**
 * Full-body 2D render you can grab, shown while the 3D model loads or if Roblox doesn't deliver it:
 * drag tilts it, wheel zooms, double-click resets, letting go swings it back.
 */
function AvatarStage({ userId }: { userId: number; }) {
    const [pose, setPose] = useState({ turn: 0, tilt: 0, zoom: 1 });
    const [dragging, setDragging] = useState(false);
    const drag = useRef<{ x: number; y: number; turn: number; tilt: number; } | null>(null);
    const stage = useRef<HTMLDivElement>(null);
    const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));

    // Wheel zoom needs a non-passive listener so the window doesn't scroll at the same time
    useEffect(() => {
        const el = stage.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            setPose(p => ({ ...p, zoom: Math.max(0.8, Math.min(1.8, p.zoom - e.deltaY * 0.0015)) }));
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

    return (
        <div
            ref={stage}
            className={classes("vc-fakerobux-wearing", dragging && "vc-fakerobux-wearing-drag")}
            title="Drag to turn · scroll to zoom · double-click to reset"
            onPointerDown={e => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, turn: pose.turn, tilt: pose.tilt };
                setDragging(true);
            }}
            onPointerMove={e => {
                const d = drag.current;
                if (!d) return;
                setPose(p => ({ ...p, turn: clamp(d.turn + (e.clientX - d.x) * 0.35, MAX_TURN), tilt: clamp(d.tilt - (e.clientY - d.y) * 0.15, MAX_TILT) }));
            }}
            onPointerUp={() => {
                drag.current = null;
                setDragging(false);
                setPose(p => ({ ...p, turn: 0, tilt: 0 }));
            }}
            onPointerCancel={() => {
                drag.current = null;
                setDragging(false);
                setPose(p => ({ ...p, turn: 0, tilt: 0 }));
            }}
            onDoubleClick={() => setPose({ turn: 0, tilt: 0, zoom: 1 })}
        >
            <span className="vc-fakerobux-floor" style={{ transform: `translateX(${pose.turn * 0.6}px) scale(${pose.zoom})` }} />
            <span
                className="vc-fakerobux-figure"
                style={{ transform: `perspective(700px) rotateX(${pose.tilt}deg) rotateY(${pose.turn}deg) scale(${pose.zoom})` }}
            >
                <UserAvatar userId={userId} kind="body" size={220} />
            </span>
        </div>
    );
}

const START_VIEW: View = { yaw: 0.35, pitch: 0.12, zoom: 1 };

/**
 * Real 3D avatar like on roblox.com: drag spins it all the way round (keeps turning a little after letting go),
 * up/down tilts the camera, wheel zooms, double-click resets. Shows the 2D stage until the model is loaded or if it fails.
 */
function Avatar3D({ userId }: { userId: number; }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        const el = canvas.current;
        if (!el) return;
        let alive = true;
        let renderer: AvatarRenderer | null = null;
        let frame = 0;
        const view = { ...START_VIEW };
        let spin = 0;
        let drag: { x: number; y: number; t: number; } | null = null;

        // Only draws while something moves
        const tick = () => {
            frame = 0;
            if (!renderer) return;
            if (!drag && Math.abs(spin) > 0.0005) {
                view.yaw += spin;
                spin *= 0.93;
            }
            renderer.render(view);
            if (!drag && Math.abs(spin) > 0.0005) frame = requestAnimationFrame(tick);
        };
        const redraw = () => { if (!frame) frame = requestAnimationFrame(tick); };

        const down = (e: PointerEvent) => {
            if (e.button !== 0) return;
            el.setPointerCapture(e.pointerId);
            drag = { x: e.clientX, y: e.clientY, t: performance.now() };
            spin = 0;
            setDragging(true);
        };
        const move = (e: PointerEvent) => {
            if (!drag) return;
            const dx = e.clientX - drag.x;
            const dy = e.clientY - drag.y;
            const now = performance.now();
            view.yaw -= dx * 0.012;
            view.pitch = Math.max(-0.6, Math.min(1.1, view.pitch + dy * 0.008));
            spin = (-dx * 0.012) * Math.min(1, 16 / Math.max(1, now - drag.t));
            drag = { x: e.clientX, y: e.clientY, t: now };
            redraw();
        };
        const up = () => {
            if (!drag) return;
            if (performance.now() - drag.t > 80) spin = 0;
            drag = null;
            setDragging(false);
            redraw();
        };
        const wheel = (e: WheelEvent) => {
            e.preventDefault();
            view.zoom = Math.max(0.6, Math.min(2.5, view.zoom * Math.exp(-e.deltaY * 0.0015)));
            redraw();
        };
        const reset = () => {
            Object.assign(view, START_VIEW);
            spin = 0;
            redraw();
        };
        const resize = new ResizeObserver(redraw);

        avatar3d(userId)
            .then(model => AvatarRenderer.create(el, model))
            .then(r => {
                if (!alive) return r.dispose();
                renderer = r;
                setState("ready");
                el.addEventListener("pointerdown", down);
                el.addEventListener("pointermove", move);
                el.addEventListener("pointerup", up);
                el.addEventListener("pointercancel", up);
                el.addEventListener("wheel", wheel, { passive: false });
                el.addEventListener("dblclick", reset);
                resize.observe(el);
                redraw();
            })
            .catch(e => {
                console.warn("[FakeRobux] 3D avatar unavailable:", e);
                if (alive) setState("failed");
            });

        return () => {
            alive = false;
            cancelAnimationFrame(frame);
            resize.disconnect();
            el.removeEventListener("pointerdown", down);
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", up);
            el.removeEventListener("pointercancel", up);
            el.removeEventListener("wheel", wheel);
            el.removeEventListener("dblclick", reset);
            renderer?.dispose();
        };
    }, [userId]);

    return (
        <div className={classes("vc-fakerobux-avatar3d", state === "ready" && "vc-fakerobux-avatar3d-ready")}>
            {state !== "ready" && <AvatarStage userId={userId} />}
            {state === "loading" && <span className="vc-fakerobux-avatar3d-status"><Spinner /> Loading 3D</span>}
            <canvas
                ref={canvas}
                className={classes("vc-fakerobux-wearing", "vc-fakerobux-canvas", dragging && "vc-fakerobux-wearing-drag")}
                title="Drag to turn · scroll to zoom · double-click to reset"
            />
        </div>
    );
}

function accountAge(created: string) {
    const days = Math.floor((Date.now() - new Date(created).getTime()) / 86_400_000);
    if (days >= 365) return `${Math.floor(days / 365)} ${days >= 730 ? "years" : "year"}`;
    return `${days} ${days === 1 ? "day" : "days"}`;
}

function RobloxBadges({ badges }: { badges: RobloxBadge[]; }) {
    return (
        <div className="vc-fakerobux-badges">
            {badges.map(b => <BadgeIcon key={b.id} badge={b} />)}
        </div>
    );
}

function BadgeIcon({ badge }: { badge: RobloxBadge; }) {
    const { value } = useAsync(() => image(badge.imageUrl), [badge.imageUrl]);
    return (
        <span className="vc-fakerobux-badge" title={badge.name}>
            {value ? <img src={value} alt="" width={44} height={44} draggable={false} /> : <Spinner />}
            <span>{badge.name}</span>
        </span>
    );
}

/** A Roblox profile like on roblox.com. own = your profile (shows your balance); actions = extra header buttons. */
export function Profile({ user, own, actions }: { user: RobloxUser; own?: boolean; actions?: ReactNode; }) {
    const { balance } = settings.use(["balance"]);
    const counts = useAsync(() => getCounts(user.id), [user.id]);
    const badges = useAsync(() => getRobloxBadges(user.id).catch(() => []), [user.id]);
    const c = counts.value;
    const n = (v: number | null | undefined) => v == null ? "–" : abbr(v);

    return (
        <>
            {/* Header like roblox.com/users/…/profile: round headshot, names, counts */}
            <div className="vc-fakerobux-profile">
                <span className="vc-fakerobux-headshot"><UserAvatar userId={user.id} size={104} /></span>
                <div className="vc-fakerobux-profile-main">
                    <span className="vc-fakerobux-profile-name">{user.displayName}{user.verified && <Verified size={18} />}</span>
                    <span className="vc-fakerobux-handle">@{user.name}</span>
                    <div className="vc-fakerobux-counts">
                        <span><b>{n(c?.friends)}</b> Friends</span>
                        <span><b>{n(c?.followers)}</b> Followers</span>
                        <span><b>{n(c?.following)}</b> Following</span>
                    </div>
                </div>
                <div className="vc-fakerobux-profile-buttons">
                    {actions}
                    <Button small variant="gray" icon={ICONS.external} onClick={() => openUrl(profileUrl(user.id))}>Profile</Button>
                </div>
            </div>

            {own && <div className="vc-fakerobux-wallet">
                <span className="vc-fakerobux-wallet-label">My Balance</span>
                <div className="vc-fakerobux-wallet-amount" title={`${fmt(balance)} Robux`}>
                    <RobuxIcon size={26} />
                    <span>{fmt(balance)}</span>
                </div>
            </div>}

            {user.description?.trim() && (
                <Section title="About" plain>
                    <p className="vc-fakerobux-about">{user.description.trim()}</p>
                </Section>
            )}

            <Section title="Currently Wearing" plain>
                <Avatar3D userId={user.id} />
            </Section>

            {!!badges.value?.length && (
                <Section title="Roblox Badges" plain>
                    <RobloxBadges badges={badges.value} />
                </Section>
            )}

            <Section title="Statistics" plain>
                <div className="vc-fakerobux-statistics">
                    <span><small>Join Date</small>{user.created ? fmtDate(user.created) : "–"}</span>
                    <span><small>Account Age</small>{user.created ? accountAge(user.created) : "–"}</span>
                    <span><small>Roblox Badges</small>{badges.value ? badges.value.length : "–"}</span>
                </div>
            </Section>
        </>
    );
}

