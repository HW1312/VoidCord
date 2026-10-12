/*
 * FakeRobux – confirm dialog and receipt of a simulated donation / gift.
 * The "Simulated" marks are part of the design and can't be turned off: nothing is sent, nobody gets anything.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { useEffect, useState } from "@webpack/common";

import { Glyph, ICONS, Note, openWindow, Row, Section, Sheet, Spinner } from "../_ui";
import { CatalogItem, RobloxUser } from "./api";
import { fmtDate, ItemThumb, Robux, RobuxIcon, SimulatedTag, THEME, UserAvatar, UserName } from "./components";
import { HistoryEntry, settings, spend } from "./index";

export interface PurchaseRequest {
    recipient: RobloxUser;
    amount: number;
    message?: string;
    /** Gift: the catalog item and its thumbnail URL; donation without */
    item?: CatalogItem;
    thumbUrl?: string;
}

type Step = "confirm" | "processing" | "done";

function Hero({ req }: { req: PurchaseRequest; }) {
    return (
        <div className="vc-fakerobux-hero">
            {req.item
                ? <ItemThumb url={req.thumbUrl} size={96} item={req.item} />
                : <span className="vc-fakerobux-hero-robux"><RobuxIcon size={48} /></span>}
            <span className="vc-fakerobux-hero-arrow">→</span>
            <UserAvatar userId={req.recipient.id} size={96} />
        </div>
    );
}

function Receipt({ entry }: { entry: HistoryEntry; }) {
    return (
        <div className="vc-fakerobux-receipt">
            <span className="vc-fakerobux-stamp" aria-hidden>SIMULATED</span>
            <div className="vc-fakerobux-receipt-head">
                <Glyph path={ICONS.check} color="green" size={36} />
                <b>{entry.kind === "gift" ? "Gift simulated" : "Donation simulated"}</b>
                <span>Nothing was sent - {entry.displayName} received nothing.</span>
            </div>
            <Section>
                <Row title="To" trailing={`${entry.displayName} (@${entry.username})`} />
                {entry.item && <Row title="Item" trailing={entry.item.name} />}
                <Row title="Amount" trailing={<Robux value={entry.amount} />} />
                {entry.message && <Row title="Message" trailing={entry.message} />}
                <Row title="Date" trailing={`${fmtDate(entry.at)}, ${new Date(entry.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`} />
                <Row title="Status" trailing={<SimulatedTag />} />
            </Section>
        </div>
    );
}

function Purchase({ req, close }: { req: PurchaseRequest; close(): void; }) {
    const { balance } = settings.use(["balance"]);
    const [step, setStep] = useState<Step>("confirm");
    const [entry, setEntry] = useState<HistoryEntry | null>(null);
    const enough = balance >= req.amount;
    const gift = !!req.item;

    useEffect(() => {
        if (step !== "processing") return;
        const t = setTimeout(() => {
            const done = spend({
                kind: gift ? "gift" : "donate",
                amount: req.amount,
                userId: req.recipient.id,
                username: req.recipient.name,
                displayName: req.recipient.displayName,
                message: req.message || undefined,
                item: req.item && { id: req.item.id, itemType: req.item.itemType, name: req.item.name }
            });
            if (done) {
                setEntry(done);
                setStep("done");
            } else setStep("confirm");
        }, 1400);
        return () => clearTimeout(t);
    }, [step]);

    // Roblox's own purchase prompt: plain title, no app icon
    const header = {
        title: step === "done" ? (gift ? "Gift Completed" : "Robux Sent") : (gift ? "Buy Item" : "Send Robux"),
        subtitle: <SimulatedTag />
    };

    if (step === "done" && entry) {
        return (
            <Sheet header={header} onClose={close} actions={[{ label: "Done", onClick: close }]}>
                <Receipt entry={entry} />
            </Sheet>
        );
    }

    return (
        <Sheet
            header={header}
            onClose={close}
            notice={enough ? undefined : "You don't have enough Robux. Raise your balance in the plugin settings."}
            actions={[
                { label: "Cancel", onClick: close },
                {
                    label: step === "processing" ? <><Spinner /> Processing</> : gift ? "Buy Now (simulated)" : "Send (simulated)",
                    color: "green",
                    disabled: !enough || step === "processing",
                    onClick: () => setStep("processing")
                }
            ]}
        >
            <Hero req={req} />
            <p className="vc-fakerobux-question">
                {gift
                    ? <>Gift <b>{req.item!.name}</b> to <b>{req.recipient.displayName}</b> for <Robux value={req.amount} />?</>
                    : <>Send <Robux value={req.amount} /> to <b>{req.recipient.displayName}</b>?</>}
            </p>
            <Section>
                <Row
                    leading={<UserAvatar userId={req.recipient.id} size={32} />}
                    title={<UserName displayName={req.recipient.displayName} name={req.recipient.name} verified={req.recipient.verified} />}
                />
                {req.message && <Row title="Message" trailing={req.message} />}
                <Row title="Your balance" trailing={<Robux value={balance} />} />
                <Row title="After" trailing={<Robux value={Math.max(0, balance - req.amount)} />} dim={!enough} />
            </Section>
            <Note tone="warn">Simulation - no Robux are sent and {req.recipient.displayName} gets nothing. Only your fake balance goes down.</Note>
        </Sheet>
    );
}

export function openPurchase(req: PurchaseRequest) {
    openWindow(close => (
        <ErrorBoundary noop>
            <Purchase req={req} close={close} />
        </ErrorBoundary>
    ), { size: "small", className: THEME });
}

export function openReceipt(entry: HistoryEntry) {
    openWindow(close => (
        <ErrorBoundary noop>
            <Sheet
                header={{ title: entry.kind === "gift" ? "Gift" : "Donation", subtitle: <SimulatedTag /> }}
                onClose={close}
                actions={[{ label: "Close", onClick: close }]}
            >
                <Receipt entry={entry} />
            </Sheet>
        </ErrorBoundary>
    ), { size: "small", className: THEME });
}
