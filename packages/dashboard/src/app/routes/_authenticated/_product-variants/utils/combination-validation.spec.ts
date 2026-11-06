import { describe, expect, it } from 'vitest';

import { findConflictingVariant, SiblingVariant } from './combination-validation.js';

describe('findConflictingVariant', () => {
    const siblings: SiblingVariant[] = [
        { id: '1', name: 'Laptop Small', sku: 'L-SM', optionIds: ['size-s', 'ram-8'] },
        { id: '2', name: 'Laptop Medium', sku: 'L-MD', optionIds: ['size-m', 'ram-8'] },
    ];

    it('returns the sibling that uses the same set of option ids', () => {
        const conflict = findConflictingVariant(['size-s', 'ram-8'], siblings, '99');
        expect(conflict?.id).toBe('1');
    });

    it('matches regardless of option id order', () => {
        const conflict = findConflictingVariant(['ram-8', 'size-m'], siblings, '99');
        expect(conflict?.id).toBe('2');
    });

    it('returns undefined for a unique combination', () => {
        expect(findConflictingVariant(['size-l', 'ram-8'], siblings, '99')).toBeUndefined();
    });

    it('excludes the variant being edited so it never conflicts with itself', () => {
        // Editing variant "1" back to its own combination must not report a conflict.
        expect(findConflictingVariant(['size-s', 'ram-8'], siblings, '1')).toBeUndefined();
    });

    it('returns undefined when there are no siblings', () => {
        expect(findConflictingVariant(['size-s'], [], '99')).toBeUndefined();
    });
});
