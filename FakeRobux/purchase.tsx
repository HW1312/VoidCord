/*
 * FakeRobux – confirm dialog and receipt of a simulated donation / gift.
 * Transactions update local plugin state only.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { useEffect, useState } from "@webpack/common";

import { classes, openWindow, Row, Section, Sheet, Spinner } from "../_ui";
import { CatalogItem, RobloxUser } from "./api";
import { fmtDate, ItemThumb, Robux, THEME, UserAvatar } from "./components";
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

// Roblox's purchase prompt shows one big picture: the item, or the person who gets the Robux
function Hero({ req }: { req: PurchaseRequest; }) {
    return (
        <div className="vc-fakerobux-hero">
            {req.item
                ? <ItemThumb url={req.thumbUrl} size={150} item={req.item} />
                : <UserAvatar userId={req.recipient.id} size={150} />}
        </div>
    );
}

function ReceiptSummary({ entry }: { entry: HistoryEntry; }) {
    return (
        <div className="vc-fakerobux-receipt-head">
            <svg viewBox="0 0 32 32" width={48} height={48} className="vc-fakerobux-receipt-check" aria-hidden>
                <path fill="currentColor" d="M28 16C28 9.37258 22.6274 4 16 4C9.37258 4 4 9.37258 4 16C4 22.6274 9.37258 28 16 28C22.6274 28 28 22.6274 28 16ZM30 16C30 23.732 23.732 30 16 30C8.26801 30 2 23.732 2 16C2 8.26801 8.26801 2 16 2C23.732 2 30 8.26801 30 16ZM21.7071 12.2929C22.0976 12.6834 22.0976 13.3166 21.7071 13.7071L14.7071 20.7071C14.3166 21.0976 13.6834 21.0976 13.2929 20.7071L10.2929 17.7071C9.90237 17.3166 9.90237 16.6834 10.2929 16.2929C10.6834 15.9024 11.3166 15.9024 11.7071 16.2929L14 18.5858L20.2929 12.2929C20.6834 11.9024 21.3166 11.9024 21.7071 12.2929Z" />
            </svg>
            <span>
                {entry.kind === "gift"
                    ? <>Your gift to <b>{entry.displayName}</b> is complete.</>
                    : <>You sent <Robux value={entry.amount} /> to <b>{entry.displayName}</b>.</>}
            </span>
        </div>
    );
}

function Receipt({ entry }: { entry: HistoryEntry; }) {
    return (
        <div className="vc-fakerobux-receipt">
            <ReceiptSummary entry={entry} />
            <Section>
                <Row title="To" trailing={`${entry.displayName} (@${entry.username})`} />
                {entry.item && <Row title="Item" trailing={entry.item.name} />}
                <Row title="Amount" trailing={<Robux value={entry.amount} />} />
                {entry.message && <Row title="Message" trailing={entry.message} />}
                <Row title="Date" trailing={`${fmtDate(entry.at)}, ${new Date(entry.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`} />
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
        }, 1000 + Math.floor(Math.random() * 2001));
        return () => clearTimeout(t);
    }, [step]);

    // Roblox's own purchase prompt: plain title, no app icon
    const header = {
        title: step === "done" ? (gift ? "Gift Completed" : "Robux Sent") : (gift ? "Buy Item" : "Send Robux")
    };

    if (step === "done" && entry) {
        return (
            <Sheet
                className="vc-fakerobux-completion"
                header={{
                    ...header,
                    actions: <span className="vc-fakerobux-completion-balance"><Robux value={balance} size={16} /></span>
                }}
                onClose={close}
                actions={[{ label: "OK", onClick: close }]}
            >
                <ReceiptSummary entry={entry} />
            </Sheet>
        );
    }

    return (
        <Sheet
            header={header}
            onClose={close}
            notice={enough ? undefined : "You don't have enough Robux. Raise your balance in the plugin settings."}
            footer={
                <span className="vc-fakerobux-after">
                    Your balance after this transaction will be <Robux value={Math.max(0, balance - req.amount)} size={12} />
                </span>
            }
            actions={[
                { label: "Cancel", onClick: close },
                {
                    label: step === "processing" ? <><Spinner /> Processing</> : gift ? "Buy Now" : "Send Now",
                    color: "green",
                    disabled: !enough || step === "processing",
                    onClick: () => setStep("processing")
                }
            ]}
        >
            <Hero req={req} />
            <p className="vc-fakerobux-question">
                {gift
                    ? <>Would you like to gift <b>{req.item!.name}</b> to <b>{req.recipient.displayName}</b> for <Robux value={req.amount} />?</>
                    : <>Would you like to send <Robux value={req.amount} /> to <b>{req.recipient.displayName}</b>?</>}
            </p>
            {req.message && <p className="vc-fakerobux-message">“{req.message}”</p>}
        </Sheet>
    );
}

export function openPurchase(req: PurchaseRequest) {
    openWindow(close => (
        <ErrorBoundary noop>
            <Purchase req={req} close={close} />
        </ErrorBoundary>
    ), { size: "medium", className: classes(THEME, "vc-fakerobux-purchase") });
}

export function openReceipt(entry: HistoryEntry) {
    openWindow(close => (
        <ErrorBoundary noop>
            <Sheet
                header={{ title: entry.kind === "gift" ? "Gift Completed" : "Robux Sent" }}
                onClose={close}
                actions={[{ label: "Close", color: "green", onClick: close }]}
            >
                <Receipt entry={entry} />
            </Sheet>
        </ErrorBoundary>
    ), { size: "medium", className: classes(THEME, "vc-fakerobux-purchase") });
}
