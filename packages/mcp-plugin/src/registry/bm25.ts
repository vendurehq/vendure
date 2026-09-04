const STOPWORDS = new Set(
    (
        'a an the of to for and or in on at by with from this that these those is are be as it its ' +
        'my your our their i we you me us them'
    ).split(' '),
);

// Whole-word matching lets a nonsense query score zero and trigger the no-results hint, which substring matching could not.
export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(token => token.length > 0 && !STOPWORDS.has(token));
}

interface Bm25Doc {
    termCounts: Map<string, number>;
    length: number;
}

// Standard Okapi BM25 tuning values.
const K1 = 1.5;
const B = 0.75;

// Rare query terms count more than common ones, so a "refund" hit says more than an "order" hit when half the tools mention orders.
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
