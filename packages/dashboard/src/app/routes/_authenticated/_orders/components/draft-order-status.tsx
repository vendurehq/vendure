import { Alert, AlertDescription, AlertTitle } from '@/vdb/components/ui/alert.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { AlertTriangle, CheckCircle } from 'lucide-react';

export type DraftOrderStatusProps = Readonly<{
    hasCustomer: boolean;
    hasLines: boolean;
    hasShippingMethod: boolean;
    isDraftState: boolean;
}>;

export function DraftOrderStatus({
    hasCustomer,
    hasLines,
    hasShippingMethod,
    isDraftState,
}: DraftOrderStatusProps) {
    const { t } = useLingui();
    const isCompleteDraftDisabled = !hasCustomer || !hasLines || !hasShippingMethod || !isDraftState;

    let completeDraftDisabledReason: string | null = null;
    if (!hasCustomer) {
        completeDraftDisabledReason = t`Select a customer to continue`;
    } else if (!hasLines) {
        completeDraftDisabledReason = t`Add at least one item to the order`;
    } else if (!hasShippingMethod) {
        completeDraftDisabledReason = t`Set a shipping address and select a shipping method`;
    } else if (!isDraftState) {
        completeDraftDisabledReason = t`Only draft orders can be completed`;
    }

    const Icon = isCompleteDraftDisabled ? AlertTriangle : CheckCircle;
    const title = isCompleteDraftDisabled ? (
        <Trans>Order draft isn't ready to be completed</Trans>
    ) : (
        <Trans>Order draft is ready to be completed</Trans>
    );

    return (
        <Alert variant={isCompleteDraftDisabled ? 'destructive' : 'default'}>
            <Icon className={isCompleteDraftDisabled ? '' : 'stroke-success'} />
            <AlertTitle className={isCompleteDraftDisabled ? '' : 'text-success'}>{title}</AlertTitle>
            {completeDraftDisabledReason ? (
                <AlertDescription>{completeDraftDisabledReason}</AlertDescription>
            ) : null}
        </Alert>
    );
}
