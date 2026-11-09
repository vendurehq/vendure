import { describe, expect, it } from 'vitest';

import { Errors, isOnebridgeError } from '../errors';
import { allowedRfqTransitions, assertRfqTransition, canTransitionRfq } from '../transitions';
import { ONEBRIDGE_ERROR_CODES } from '../types';

describe('RFQ stage transitions', () => {
    it('allows the documented pond chain', () => {
        expect(canTransitionRfq('quoting', 'sample')).toBe(true);
        expect(canTransitionRfq('sample', 'qc')).toBe(true);
        expect(canTransitionRfq('qc', 'delivered')).toBe(true);
        expect(canTransitionRfq('delivered', 'done')).toBe(true);
    });

    it('allows the documented hook chain', () => {
        expect(canTransitionRfq('requirement', 'sourcing')).toBe(true);
        expect(canTransitionRfq('sourcing', 'producing')).toBe(true);
        expect(canTransitionRfq('producing', 'qc')).toBe(true);
        expect(canTransitionRfq('qc', 'customs')).toBe(true);
        expect(canTransitionRfq('customs', 'delivered')).toBe(true);
    });

    it('forbids skipping stages', () => {
        expect(canTransitionRfq('quoting', 'qc')).toBe(false);
        expect(canTransitionRfq('requirement', 'qc')).toBe(false);
        expect(canTransitionRfq('qc', 'done')).toBe(false);
    });

    it('treats done/lost as terminal', () => {
        expect(allowedRfqTransitions('done')).toEqual([]);
        expect(allowedRfqTransitions('lost')).toEqual([]);
        expect(canTransitionRfq('done', 'lost')).toBe(false);
    });

    it('throws INVALID_STAGE_TRANSITION with the contract code', () => {
        try {
            assertRfqTransition('quoting', 'done');
            throw new Error('should not reach');
        } catch (e) {
            expect(isOnebridgeError(e)).toBe(true);
            if (isOnebridgeError(e)) {
                expect(e.code).toBe(ONEBRIDGE_ERROR_CODES.INVALID_STAGE_TRANSITION);
            }
        }
    });

    it('keeps refund reachable only from shipping', () => {
        expect(canTransitionRfq('shipping', 'refund')).toBe(true);
        expect(canTransitionRfq('delivered', 'refund')).toBe(false);
        expect(Errors.invalidTransition('delivered', 'refund').code).toBe(
            ONEBRIDGE_ERROR_CODES.INVALID_STAGE_TRANSITION,
        );
    });
});
