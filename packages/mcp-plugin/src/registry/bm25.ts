const STOPWORDS = new Set(
    (
        'a an the of to for and or in on at by with from this that these those is are be as it its ' +
        'my your our their i we you me us them'
    ).split(' '),
);

/**
 * Lowercases and splits on any non-alphanumeric run (so snake_case names split into words),
 * then drops stopwords. Whole-word matching is what lets a nonsense query score zero and
 * trigger the zero-result hint, where substring matching could not.
 */
export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(token => token.length > 0 && !STOPWORDS.has(token));
}

interface Bm25Doc {
    /** How many times each term appears in this document. */
    termCounts: Map<string, number>;
    length: number;
}

// Standard Okapi BM25 tuning values: K1 caps how much repeated occurrences of a term add,
// B sets how strongly long documents are penalized. Retuning means editing these two lines.
const K1 = 1.5;
const B = 0.75;

/**
 * Okapi BM25 over a fixed set of named documents. Rare query terms count more than common
 * ones (a "refund" hit says more than an "order" hit when half the tools mention orders).
 * The corpus is fixed after tool discovery, so the index is built once at bootstrap and
 * never needs maintenance.
 */
export class Bm25Index {
    private readonly docs = new Map<string, Bm25Doc>();
    private readonly df = new Map<string, number>();
    private readonly avgLength: number;

    constructor(entries: Array<{ id: string; text: string }>) {
        for (const { id, text } of entries) {
            const tokens = tokenize(text);
            const termCounts = new Map<string, number>();
            for (const token of tokens) {
                termCounts.set(token, (termCounts.get(token) ?? 0) + 1);
            }
            this.docs.set(id, { termCounts, length: tokens.length });
            for (const term of termCounts.keys()) {
                this.df.set(term, (this.df.get(term) ?? 0) + 1);
            }
        }
        const totalLength = [...this.docs.values()].reduce((sum, doc) => sum + doc.length, 0);
        this.avgLength = this.docs.size > 0 ? totalLength / this.docs.size : 0;
    }

    /** BM25 relevance of one document for the query; 0 when no query term occurs in it. */
    score(id: string, query: string): number {
        const doc = this.docs.get(id);
        if (!doc || doc.length === 0) {
            return 0;
        }
        let score = 0;
        for (const term of tokenize(query)) {
            const frequency = doc.termCounts.get(term) ?? 0;
            if (frequency === 0) {
                continue;
            }
            const df = this.df.get(term) ?? 0;
            const idf = Math.log(1 + (this.docs.size - df + 0.5) / (df + 0.5));
            const numerator = frequency * (K1 + 1);
            const denominator = frequency + K1 * (1 - B + B * (doc.length / this.avgLength));
            score += idf * (numerator / denominator);
        }
        return score;
    }
}
