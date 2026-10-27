// Same behaviour as Vencord's classNameFactory / classes

type Arg = string | string[] | Record<string, unknown> | null | undefined | false;

export const classNameFactory = (prefix = "") => (...args: Arg[]) => {
    const names = new Set<string>();
    for (const arg of args) {
        if (arg && typeof arg === "string") names.add(arg);
        else if (Array.isArray(arg)) arg.forEach(n => names.add(n));
        else if (arg && typeof arg === "object") Object.entries(arg).forEach(([n, v]) => v && names.add(n));
    }
    return Array.from(names, n => prefix + n).join(" ");
};

export const classes = (...c: Array<string | null | undefined | false>) => c.filter(Boolean).join(" ");
