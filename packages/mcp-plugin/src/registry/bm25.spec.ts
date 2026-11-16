import { describe, expect, it } from 'vitest';

import { Bm25Index, tokenize } from './bm25';

describe('tokenize', () => {
    it('lowercases, splits snake_case and punctuation, drops stopwords', () => {
        expect(tokenize('Refund_Order: give the money back!')).toEqual([
            'refund',
            'order',
            'give',
            'money',
            'back',
        ]);
    });

    it('returns empty for stopword-only text', () => {
        expect(tokenize('the of an in')).toEqual([]);
    });
});

describe('Bm25Index', () => {
    // 'order' is a common term (3 of 4 docs); 'refund' is rare (1 doc).
    const index = new Bm25Index([
        { id: 'issue_refund', text: 'refund payment' },
        { id: 'get_order', text: 'get order' },
        { id: 'list_orders', text: 'list order' },
        { id: 'cancel_order', text: 'cancel order' },
    ]);

    it('scores 0 for a document containing no query term', () => {
        expect(index.score('get_order', 'refund')).toBe(0);
    });

    it('weights rare terms above common ones', () => {
        expect(index.score('issue_refund', 'refund order')).toBeGreaterThan(
            index.score('get_order', 'refund order'),
        );
    });
});
