/*
 * ImageText – text window & settings list
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { copyToClipboard } from "@utils/clipboard";
import { IS_WINDOWS } from "@utils/constants";
import { showToast, useEffect, useRef, useState } from "@webpack/common";
import type { RefObject } from "react";

import { Empty, Note, openWindow, Row, Section, Sheet, Spinner, strokeIcon } from "../_ui";
import { joinText, Native, recognize } from "./index";
import type { OcrLanguage, OcrResult } from "./native";

// Lucide scan-text
export const TEXT_ICON = strokeIcon("M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2", "M7 8h8", "M7 12h10", "M7 16h6");
const ICON_COLOR = "mint" as const;

// ---------------------------------------------------------------- Text window

type State =
    | { status: "loading"; }
    | { status: "done"; result: OcrResult; };

function TextView({ state, text, setText, textareaRef }: {
    state: State;
    text: string;
    setText(text: string): void;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
    if (state.status === "loading") {
        return <Empty title={<span className="vc-imagetext-loading"><Spinner /> Reading text from image …</span>} />;
    }

    const { result } = state;
    if (!result.ok) {
        return <Note tone="bad">Could not read text: {result.error}</Note>;
    }

    return (
        <Section footer="Select a part of the text to copy only that part.">
            {!result.lines.some(l => l.trim()) && <Row title="No text found. You can still type into the box." dim />}
            {/* kit TextArea classes; plain element because the selection is read through the ref */}
            <textarea
                ref={textareaRef}
                className="vc-ui-field vc-ui-textarea vc-imagetext-textarea"
                value={text}
                onChange={e => setText(e.currentTarget.value)}
                spellCheck={false}
                autoFocus
            />
        </Section>
    );
}

function TextWindow({ src, close }: { src: string; close(): void; }) {
    const [state, setState] = useState<State>({ status: "loading" });
    const [text, setText] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        let alive = true;
        recognize(src).then(result => {
            if (!alive) return;
            setState({ status: "done", result });
            if (result.ok) setText(joinText(result.lines.filter(l => l.trim())));
        });
        return () => { alive = false; };
    }, [src]);

    const lineCount = text.split("\n").filter(l => l.trim()).length;
    const subtitle = state.status === "done" && state.result.ok
        ? `${lineCount} ${lineCount === 1 ? "line" : "lines"}${state.result.language ? ` · OCR language: ${state.result.language}` : ""}`
        : undefined;

    function copy() {
        const el = textareaRef.current;
        const selected = el && el.selectionStart !== el.selectionEnd
            ? el.value.slice(el.selectionStart, el.selectionEnd)
            : text;
        if (!selected.trim()) {
            showToast("Nothing to copy", "message");
            return;
        }
        void copyToClipboard(selected).then(
            () => showToast(selected === text ? "Copied text" : "Copied selection", "success"),
            () => showToast("Could not copy the text", "failure")
        );
    }

    const canCopy = state.status === "done" && state.result.ok;

    return (
        <Sheet
            header={{ app: "ImageText", title: "Text from image", subtitle, icon: TEXT_ICON, iconColor: ICON_COLOR }}
            onClose={close}
            actions={[
                { label: "Close", onClick: close },
                { label: "Copy", onClick: copy, disabled: !canCopy }
            ]}
        >
            <TextView state={state} text={text} setText={setText} textareaRef={textareaRef} />
        </Sheet>
    );
}

export function openTextModal(src: string) {
    openWindow(close => <TextWindow src={src} close={close} />, { size: "medium" });
}

// ---------------------------------------------------------------- Settings: installed languages

export const LanguageList = ErrorBoundary.wrap(() => {
    const [languages, setLanguages] = useState<OcrLanguage[] | null>(null);

    useEffect(() => {
        if (!IS_WINDOWS || !Native) return;
        Native.getLanguages().then(setLanguages, () => setLanguages([]));
    }, []);

    let body: string;
    if (!IS_WINDOWS || !Native) body = "Only available in the Discord desktop app on Windows.";
    else if (!languages) body = "Loading …";
    else if (!languages.length) body = "None found. Add a language with the optical character recognition feature in Windows Settings > Time & language > Language.";
    else body = languages.map(l => `${l.name} (${l.tag})`).join(", ");

    return (
        <Sheet embedded>
            <Section title="Installed OCR languages">
                <Row align="top" title={body} trailing={languages === null && IS_WINDOWS && Native ? <Spinner /> : undefined} />
            </Section>
        </Sheet>
    );
}, { noop: true });
