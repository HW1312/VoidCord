/*
 * FolderUpload – .gitignore matching (the parts of git's rules that matter for zipping a folder)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface IgnoreRule {
    /** Folder (relative to the zipped folder) of the .gitignore the rule comes from, "" = top */
    base: string;
    re: RegExp;
    negate: boolean;
    dirOnly: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

function globToRegex(p: string) {
    let out = "";
    for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (c === "*") {
            if (p[i + 1] === "*") {
                // "**" only means "any depth" as a whole path segment, otherwise it's a normal *
                const segStart = i === 0 || p[i - 1] === "/";
                const segEnd = i + 2 === p.length || p[i + 2] === "/";
                if (segStart && segEnd) {
                    if (i + 2 === p.length) {
                        out += ".*";
                        i++;
                    } else {
                        out += "(?:.*/)?";
                        i += 2;
                    }
                    continue;
                }
                i++;
            }
            out += "[^/]*";
        } else if (c === "?") {
            out += "[^/]";
        } else if (c === "[") {
            // A "]" right after "[" or "[!" belongs to the set
            let j = i + 1;
            if (p[j] === "!" || p[j] === "^") j++;
            if (p[j] === "]") j++;
            const end = p.indexOf("]", j);
            if (end === -1) {
                out += "\\[";
                continue;
            }
            let set = p.slice(i + 1, end);
            const negated = set[0] === "!" || set[0] === "^";
            if (negated) set = set.slice(1);
            out += `[${negated ? "^" : ""}${set.replace(/[\\\]\[]/g, "\\$&")}]`;
            i = end;
        } else if (c === "\\" && i + 1 < p.length) {
            out += escape(p[++i]);
        } else {
            out += escape(c);
        }
    }
    return out;
}

/** Parses one .gitignore. base = its folder relative to the zipped folder ("" = top). */
export function parseGitignore(text: string, base: string): IgnoreRule[] {
    const rules: IgnoreRule[] = [];
    for (let line of text.split(/\r?\n/)) {
        // Trailing spaces don't count unless escaped
        line = line.replace(/(?<!\\) +$/, "");
        if (!line || line.startsWith("#")) continue;

        let negate = false;
        if (line.startsWith("!")) {
            negate = true;
            line = line.slice(1);
        } else if (line.startsWith("\\!") || line.startsWith("\\#")) {
            line = line.slice(1);
        }

        let dirOnly = false;
        if (line.endsWith("/")) {
            dirOnly = true;
            line = line.slice(0, -1);
        }
        if (!line) continue;

        // A slash at the start or in the middle ties the pattern to the .gitignore's folder,
        // without one it matches the name at any depth
        const anchored = line.includes("/");
        if (line.startsWith("/")) line = line.slice(1);
        const body = globToRegex(line);
        // Git on Windows ignores case (core.ignorecase)
        rules.push({ base, negate, dirOnly, re: new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`, "i") });
    }
    return rules;
}

/**
 * rules: from the top .gitignore down to the deepest one, each in file order – the last match wins, like in git.
 * path is relative to the zipped folder, with "/" separators.
 */
export function isIgnored(path: string, isDir: boolean, rules: IgnoreRule[]) {
    let ignored = false;
    for (const r of rules) {
        if (r.dirOnly && !isDir) continue;
        const rel = r.base ? path.slice(r.base.length + 1) : path;
        if (r.re.test(rel)) ignored = !r.negate;
    }
    return ignored;
}
