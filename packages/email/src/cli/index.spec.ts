import { describe, expect, it } from 'vitest';

import { formatEmailList } from './index';

describe('formatEmailList()', () => {
    it('marks emails that can be sent from the order page and emails without sample data', () => {
        const lines = formatEmailList([
            {
                type: 'order-shipped',
                label: 'Order shipped',
                event: 'FulfillmentStateTransitionEvent',
                hasSample: true,
                canSendFromOrder: true,
            },
            {
                type: 'custom',
                label: 'Custom',
                event: 'CustomEvent',
                hasSample: false,
                canSendFromOrder: false,
            },
        ]).split('\n');
        expect(lines[0]).toMatch(/^order-shipped .* order page$/);
        expect(lines[0]).not.toContain('no sample');
        expect(lines[1]).toMatch(/^custom .* \(no sample\)$/);
    });
});
