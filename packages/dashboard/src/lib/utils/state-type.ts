import { defineStateEntries } from '@/vdb/components/ui/status-badge.js';

/**
 * The order-domain state dictionary. Covers order, payment and fulfillment
 * states, which all share Vendure's order-process state vocabulary. Custom
 * process states that are not listed here fall back to `neutral` via
 * `toneFor` (see `defineStateEntries`).
 *
 * Tone rationale (see design-system state dictionary):
 * - terminal & healthy (Delivered / Settled / Completed) → `success`
 * - awaiting admin action (ArrangingPayment / ArrangingAdditionalPayment /
 *   Modifying / Pending) → `warning`
 * - user/terminal cancellation → `neutral` (a cancelled order is an outcome,
 *   not a failure)
 * - hard failure (Declined / Error) → `critical`
 */
export const orderStateDictionary = defineStateEntries({
    Delivered: { tone: 'success', defaultLabel: 'Delivered' },
    Settled: { tone: 'success', defaultLabel: 'Settled' },
    Completed: { tone: 'success', defaultLabel: 'Completed' },
    ArrangingPayment: { tone: 'warning', defaultLabel: 'Arranging payment' },
    ArrangingAdditionalPayment: { tone: 'warning', defaultLabel: 'Arranging additional payment' },
    Modifying: { tone: 'warning', defaultLabel: 'Modifying' },
    Pending: { tone: 'warning', defaultLabel: 'Pending' },
    Cancelled: { tone: 'neutral', defaultLabel: 'Cancelled' },
    Declined: { tone: 'critical', defaultLabel: 'Declined' },
    Error: { tone: 'critical', defaultLabel: 'Error' },
});
