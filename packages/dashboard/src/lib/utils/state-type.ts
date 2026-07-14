import type { BadgeProps } from '../components/ui/badge.js';

export type StateType = 'default' | 'destructive' | 'success' | 'warning';

export function getTypeForState(state: string): StateType {
    const stateLower = state.toLowerCase();
    switch (stateLower) {
        case 'cancelled':
        case 'error':
            return 'destructive';
        case 'completed':
        case 'settled':
        case 'delivered':
            return 'success';
        case 'pending':
        case 'arrangingpayment':
        case 'arrangingadditionalpayment':
        case 'modifying':
            return 'warning';
        default:
            return 'default';
    }
}

export function stateTypeToBadgeVariant(type: StateType): BadgeProps['variant'] {
    switch (type) {
        case 'success':
            return 'success';
        case 'destructive':
            return 'destructive';
        case 'warning':
            return 'warning';
        default:
            return 'secondary';
    }
}
