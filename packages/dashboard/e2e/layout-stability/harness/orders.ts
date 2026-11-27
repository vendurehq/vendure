/**
 * Release orders for a set of held operations: every permutation up to four
 * operations, ten seeded random orders above that. The seed comes from
 * `LAYOUT_SEED` when set, so a failing order reproduces.
 */

export const MAX_PERMUTED = 4;
export const RANDOM_ORDERS = 10;

export function layoutSeed(): number {
    const fromEnv = Number(process.env.LAYOUT_SEED);
    return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : Math.floor(Math.random() * 2 ** 31) + 1;
}

/** mulberry32: a small seeded generator, enough to shuffle a handful of names. */
function random(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items.slice()];
    return items.flatMap((item, i) =>
        permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]),
    );
}

export function releaseOrders(ops: string[], seed: number): string[][] {
    const unique = [...new Set(ops)];
    if (unique.length <= MAX_PERMUTED) return permutations(unique);
    const next = random(seed);
    const orders: string[][] = [];
    const seen = new Set<string>();
    // The arrival order first: it is the order a fast network gives.
    for (let tries = 0; orders.length < RANDOM_ORDERS && tries < RANDOM_ORDERS * 20; tries++) {
        const order = tries === 0 ? unique.slice() : shuffle(unique, next);
        const key = order.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        orders.push(order);
    }
    return orders;
}

function shuffle<T>(items: T[], next: () => number): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}
