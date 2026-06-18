import { HistoryEntry, HistoryEntryProps } from '@/vdb/framework/history-entry/history-entry.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { Trans } from '@lingui/react/macro';
import { uiConfig } from 'virtual:vendure-ui-config';

export function OrderStateTransitionComponent(props: Readonly<HistoryEntryProps>) {
    const { entry } = props;
    if (entry.data.from === 'Created') return null;

    return (
        <HistoryEntry {...props}>
            <p className="text-xs text-muted-foreground">
                <Trans>
                    From {entry.data.from} to {entry.data.to}
                </Trans>
            </p>
        </HistoryEntry>
    );
}

export function OrderPaymentTransitionComponent(props: Readonly<HistoryEntryProps>) {
    const { entry } = props;
    return (
        <HistoryEntry {...props}>
            <p className="text-xs text-muted-foreground">
                <Trans>
                    Payment #{entry.data.paymentId} transitioned to {entry.data.to}
                </Trans>
            </p>
        </HistoryEntry>
    );
}

export function OrderRefundTransitionComponent(props: Readonly<HistoryEntryProps>) {
    const { entry } = props;
    return (
        <HistoryEntry {...props}>
            <p className="text-xs text-muted-foreground">
                <Trans>
                    Refund #{entry.data.refundId} transitioned to {entry.data.to}
                </Trans>
            </p>
        </HistoryEntry>
    );
}

export function OrderFulfillmentTransitionComponent(props: Readonly<HistoryEntryProps>) {
    const { entry } = props;
    return (
        <HistoryEntry {...props}>
            <p className="text-xs text-muted-foreground">
                <Trans>
                    Fulfillment #{entry.data.fulfillmentId} from {entry.data.from} to {entry.data.to}
                </Trans>
            </p>
        </HistoryEntry>
    );
}

export function OrderFulfillmentComponent(props: Readonly<HistoryEntryProps>) {
    const { entry } = props;
    return (
        <HistoryEntry {...props}>
            <p className="text-xs text-muted-foreground">
                <Trans>Fulfillment #{entry.data.fulfillmentId} created</Trans>
            </p>
        </HistoryEntry>
    );
}

export function OrderModifiedComponent(props: Readonly<HistoryEntryProps>) {
    const { entry } = props;
    return (
        <HistoryEntry {...props}>
            <p className="text-xs text-muted-foreground">
                <Trans>Order modification #{entry.data.modificationId}</Trans>
            </p>
        </HistoryEntry>
    );
}

export function OrderCustomerUpdatedComponent(props: Readonly<HistoryEntryProps>) {
    return (
        <HistoryEntry {...props}>
            <p className="text-xs text-muted-foreground">
                <Trans>Customer information updated</Trans>
            </p>
        </HistoryEntry>
    );
}

export function OrderCancellationComponent(props: Readonly<HistoryEntryProps>) {
    const { entry } = props;
    const { getTranslatedRefundReason } = useDynamicTranslations();

    const lines = entry.data.lines as Array<{ orderLineId: string; quantity: number }> | undefined;
    const reason = entry.data.reason as string | undefined;
    const shippingCancelled = entry.data.shippingCancelled as boolean | undefined;

    const totalQuantity = lines?.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
    const hasDetails = totalQuantity > 0 || shippingCancelled || reason;

    const getTranslatedReason = (reasonValue: string) => {
        const { refundReasons } = uiConfig.orders;
        const reasonConfig = refundReasons.find(r => r.value === reasonValue);
        if (reasonConfig) {
            return getTranslatedRefundReason(reasonConfig.label);
        }
        return reasonValue;
    };

    return (
        <HistoryEntry {...props}>
            <div className="text-xs text-muted-foreground space-y-1">
                {totalQuantity > 0 && (
                    <p>
                        <Trans>{totalQuantity} item(s) refunded</Trans>
                    </p>
                )}
                {shippingCancelled && (
                    <p>
                        <Trans>Shipping refunded</Trans>
                    </p>
                )}
                {reason && (
                    <p>
                        <Trans>Reason:</Trans> {getTranslatedReason(reason)}
                    </p>
                )}
                {!hasDetails && (
                    <p>
                        <Trans>Order cancelled</Trans>
                    </p>
                )}
            </div>
        </HistoryEntry>
    );
}
