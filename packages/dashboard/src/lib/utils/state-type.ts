import { defineStateEntries } from '@/vdb/components/ui/status-badge.js';

/**
 * The order-domain state dictionary. Covers order, payment and fulfillment
 * states, which all share Vendure's order-process state vocabulary. Custom
 * process states that are not listed here fall back to `neutral` via
 * `toneFor` (see `defineStateEntries`).
 *
 * Tone rationale (see design-system state dictionary):
 * - routine / healthy states stay `neutral` so badges do not create constant visual noise
 * - noteworthy but healthy states (authorized / partially fulfilled) → `info`
 * - awaiting action (ArrangingPayment / ArrangingAdditionalPayment / Pending) → `warning`
 * - work actively in progress (Modifying) → `progress`
 * - user/terminal cancellation → `neutral` (a cancelled order is an outcome,
 *   not a failure)
 * - hard failure (Declined / Error) → `critical`
 */
export const orderStateDictionary = defineStateEntries({
    Created: { tone: 'neutral', defaultLabel: 'Created' },
    Draft: { tone: 'neutral', defaultLabel: 'Draft' },
    AddingItems: { tone: 'neutral', defaultLabel: 'Adding items' },
    ArrangingPayment: { tone: 'warning', defaultLabel: 'Arranging payment' },
    PaymentAuthorized: { tone: 'info', defaultLabel: 'Payment authorized' },
    PaymentSettled: { tone: 'neutral', defaultLabel: 'Payment settled' },
    PartiallyShipped: { tone: 'info', defaultLabel: 'Partially shipped' },
    Shipped: { tone: 'neutral', defaultLabel: 'Shipped' },
    PartiallyDelivered: { tone: 'info', defaultLabel: 'Partially delivered' },
    Delivered: { tone: 'neutral', defaultLabel: 'Delivered' },
    Modifying: { tone: 'progress', defaultLabel: 'Modifying' },
    ArrangingAdditionalPayment: { tone: 'warning', defaultLabel: 'Arranging additional payment' },
    Cancelled: { tone: 'neutral', defaultLabel: 'Cancelled' },
    Authorized: { tone: 'info', defaultLabel: 'Authorized' },
    Settled: { tone: 'neutral', defaultLabel: 'Settled' },
    Declined: { tone: 'critical', defaultLabel: 'Declined' },
    Error: { tone: 'critical', defaultLabel: 'Error' },
    Pending: { tone: 'warning', defaultLabel: 'Pending' },
    Completed: { tone: 'neutral', defaultLabel: 'Completed' },
});

/**
 * Target states whose transition irreversibly cancels an order, payment or
 * fulfillment. Destructive styling keys on this action semantics rather than the
 * target state's tone: `Cancelled` is a neutral *outcome* as a state, but
 * *transitioning* to it is a destructive, irreversible action.
 */
const destructiveTransitionTargets = new Set(['Cancelled']);

/**
 * Whether transitioning to the given state is a destructive (irreversible loss)
 * action. Used to drive the red menu-item styling in the state-transition
 * dropdown and to exclude such states from the "suggested state" treatment in
 * the order-process dialog.
 */
export function isDestructiveTransition(targetState: string): boolean {
    return destructiveTransitionTargets.has(targetState);
}
