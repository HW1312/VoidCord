// bench/config.json plus the private channel list from the git-ignored channels.local.json
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const BENCH = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig() {
    const cfg = JSON.parse(readFileSync(join(BENCH, "config.json"), "utf8"));
    const channels = join(BENCH, "channels.local.json");
    cfg.channels = existsSync(channels) ? JSON.parse(readFileSync(channels, "utf8")) : [];
    return cfg;
}
