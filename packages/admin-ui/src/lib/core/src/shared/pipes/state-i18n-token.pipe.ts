import { Pipe, PipeTransform } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';

@Pipe({
    name: 'stateI18nToken',
    standalone: false,
})
export class StateI18nTokenPipe implements PipeTransform {
    private readonly stateI18nTokens = {
        Created: _('state.created'),
        Draft: _('state.draft'),
        AddingItems: _('state.adding-items'),
        ArrangingPayment: _('state.arranging-payment'),
        PaymentAuthorized: _('state.payment-authorized'),
        PaymentSettled: _('state.payment-settled'),
        PartiallyShipped: _('state.partially-shipped'),
        Shipped: _('state.shipped'),
        PartiallyDelivered: _('state.partially-delivered'),
        Authorized: _('state.authorized'),
        Delivered: _('state.delivered'),
        Cancelled: _('state.cancelled'),
        Pending: _('state.pending'),
        Settled: _('state.settled'),
        Failed: _('state.failed'),
        Error: _('state.error'),
        Declined: _('state.declined'),
        Modifying: _('state.modifying'),
        ArrangingAdditionalPayment: _('state.arranging-additional-payment'),
    };
    transform<T>(value: T): T {
        if (typeof value === 'string' && value.length) {
            const defaultStateToken = this.stateI18nTokens[value as any];
            if (defaultStateToken) {
                return defaultStateToken;
            }
            return getOrderStateTranslationToken(value as string) as T;
        }
        return value;
    }
}

export function getOrderStateTranslationToken(state: string): string {
    return (
        'state.' +
        state
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .replace(/ +/g, '-')
            .toLowerCase()
    );
}
