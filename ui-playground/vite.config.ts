/*
 * UI playground: renders the real _ui kit in the browser. Discord/Vencord imports are swapped for small stubs.
 */

import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const stub = (name: string) => fileURLToPath(new URL(`./src/stubs/${name}`, import.meta.url));

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@webpack/common": stub("webpack-common.tsx"),
            "@utils/modal": stub("modal.tsx"),
            "@utils/misc": stub("misc.ts"),
            "@api/Styles": stub("misc.ts"),
            "@api/DataStore": stub("datastore.ts"),
            "@components/ErrorBoundary": stub("error-boundary.tsx")
        },
        // the kit lives outside this folder and has no node_modules of its own
        dedupe: ["react", "react-dom"]
    },
    server: {
        port: 5180,
        fs: { allow: [".."] }
    }
});
