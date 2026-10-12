// Statistics for comparing variants: medians, bootstrap CI of the median difference, Mann-Whitney U.

export function quantile(xs, p) {
    const s = [...xs].sort((a, b) => a - b);
    if (!s.length) return NaN;
    const i = (s.length - 1) * p;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export const median = xs => quantile(xs, 0.5);

// Deterministic PRNG so a report can be regenerated with identical numbers.
function mulberry32(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 95% bootstrap CI of (median(b) - median(a)) / median(a), in percent. */
export function bootstrapRelDiff(a, b, iterations = 10000) {
    const rnd = mulberry32(1312);
    const resample = xs => Array.from(xs, () => xs[Math.floor(rnd() * xs.length)]);
    const diffs = [];
    for (let i = 0; i < iterations; i++) {
        const ma = median(resample(a));
        if (ma === 0) continue;
        diffs.push(((median(resample(b)) - ma) / Math.abs(ma)) * 100);
    }
    return [quantile(diffs, 0.025), quantile(diffs, 0.975)];
}

// Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf).
function normCdf(z) {
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
        * Math.exp(-(z * z) / 2);
    return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Two-sided Mann-Whitney U p-value (normal approximation with tie and continuity correction). */
export function mannWhitneyP(a, b) {
    const all = [...a.map(v => [v, 0]), ...b.map(v => [v, 1])].sort((x, y) => x[0] - y[0]);
    const ranks = new Array(all.length);
    let tieSum = 0;
    for (let i = 0; i < all.length;) {
        let j = i;
        while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++;
        const r = (i + j + 2) / 2;
        for (let k = i; k <= j; k++) ranks[k] = r;
        const t = j - i + 1;
        tieSum += t ** 3 - t;
        i = j + 1;
    }
    const n1 = a.length, n2 = b.length, n = n1 + n2;
    const r1 = all.reduce((s, [, g], i) => s + (g === 0 ? ranks[i] : 0), 0);
    const u = r1 - n1 * (n1 + 1) / 2;
    const mu = n1 * n2 / 2;
    const sigma = Math.sqrt((n1 * n2 / 12) * ((n + 1) - tieSum / (n * (n - 1))));
    if (!sigma) return 1;
    const z = (Math.abs(u - mu) - 0.5) / sigma;
    return Math.min(1, 2 * (1 - normCdf(z)));
}

/**
 * Compares variant b against baseline a for a "lower is better" metric.
 * A difference only counts as proven if the CI excludes 0 AND the effect reaches minEffectPct.
 */
export function compare(a, b, minEffectPct) {
    const ma = median(a), mb = median(b);
    const rel = ma ? ((mb - ma) / Math.abs(ma)) * 100 : NaN;
    const [lo, hi] = bootstrapRelDiff(a, b);
    const p = mannWhitneyP(a, b);
    let verdict = "no proven difference";
    if (hi < 0 && -rel >= minEffectPct && p < 0.05) verdict = "better";
    else if (lo > 0 && rel >= minEffectPct && p < 0.05) verdict = "worse";
    return { rel, ci: [lo, hi], p, verdict };
}
