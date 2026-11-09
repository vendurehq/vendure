"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const errors_1 = require("../errors");
const transitions_1 = require("../transitions");
const types_1 = require("../types");
(0, vitest_1.describe)('RFQ stage transitions', () => {
    (0, vitest_1.it)('allows the documented pond chain', () => {
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('quoting', 'sample')).toBe(true);
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('sample', 'qc')).toBe(true);
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('qc', 'delivered')).toBe(true);
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('delivered', 'done')).toBe(true);
    });
    (0, vitest_1.it)('allows the documented hook chain', () => {
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('requirement', 'sourcing')).toBe(true);
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('sourcing', 'producing')).toBe(true);
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('producing', 'qc')).toBe(true);
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('qc', 'customs')).toBe(true);
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('customs', 'delivered')).toBe(true);
    });
    (0, vitest_1.it)('forbids skipping stages', () => {
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('quoting', 'qc')).toBe(false);
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('requirement', 'qc')).toBe(false);
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('qc', 'done')).toBe(false);
    });
    (0, vitest_1.it)('treats done/lost as terminal', () => {
        (0, vitest_1.expect)((0, transitions_1.allowedRfqTransitions)('done')).toEqual([]);
        (0, vitest_1.expect)((0, transitions_1.allowedRfqTransitions)('lost')).toEqual([]);
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('done', 'lost')).toBe(false);
    });
    (0, vitest_1.it)('throws INVALID_STAGE_TRANSITION with the contract code', () => {
        try {
            (0, transitions_1.assertRfqTransition)('quoting', 'done');
            throw new Error('should not reach');
        }
        catch (e) {
            (0, vitest_1.expect)((0, errors_1.isOnebridgeError)(e)).toBe(true);
            if ((0, errors_1.isOnebridgeError)(e)) {
                (0, vitest_1.expect)(e.code).toBe(types_1.ONEBRIDGE_ERROR_CODES.INVALID_STAGE_TRANSITION);
            }
        }
    });
    (0, vitest_1.it)('keeps refund reachable only from shipping', () => {
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('shipping', 'refund')).toBe(true);
        (0, vitest_1.expect)((0, transitions_1.canTransitionRfq)('delivered', 'refund')).toBe(false);
        (0, vitest_1.expect)(errors_1.Errors.invalidTransition('delivered', 'refund').code).toBe(types_1.ONEBRIDGE_ERROR_CODES.INVALID_STAGE_TRANSITION);
    });
});
//# sourceMappingURL=transitions.spec.js.map