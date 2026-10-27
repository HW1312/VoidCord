import type { ReactNode } from "react";

export default function ErrorBoundary({ children }: { children?: ReactNode; noop?: boolean; }) {
    return <>{children}</>;
}
