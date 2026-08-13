import { LabeledData } from '@/vdb/components/labeled-data.js';
import { CustomFieldsForm } from '@/vdb/components/shared/custom-fields-form.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { Form } from '@/vdb/components/ui/form.js';
import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { useCustomFieldConfig } from '@/vdb/hooks/use-custom-field-config.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { isDestructiveTransition, orderStateDictionary } from '@/vdb/utils/state-type.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
    fulfillmentFragment,
    orderDetailFragment,
    transitionFulfillmentToStateDocument,
} from '../orders.graphql.js';
import { StateTransitionControl } from './state-transition-control.js';

type Order = NonNullable<ResultOf<typeof orderDetailFragment>>;

type FulfillmentDetailsProps = {
    order: Order;
    fulfillment: ResultOf<typeof fulfillmentFragment>;
    onSuccess?: () => void;
};

export function FulfillmentDetails({ order, fulfillment, onSuccess }: Readonly<FulfillmentDetailsProps>) {
    const { formatDate } = useLocalFormat();
    const { t } = useLingui();
    const { getTranslatedFulfillmentState } = useDynamicTranslations();
    const customFieldConfig = useCustomFieldConfig('Fulfillment');
    const customFieldsForm = useForm({
        values: {
            customFields: (fulfillment as any).customFields ?? {},
        },
    });

    // Create a map of order lines by ID for quick lookup
    const orderLinesMap = new Map(order.lines.map(line => [line.id, line]));

    const transitionFulfillmentMutation = useMutation({
        mutationFn: api.mutate(transitionFulfillmentToStateDocument),
        onSuccess: (result: ResultOf<typeof transitionFulfillmentToStateDocument>) => {
            const fulfillment = result.transitionFulfillmentToState;
            if (fulfillment.__typename === 'Fulfillment') {
                toast.success(t`Fulfillment state updated successfully`);
                onSuccess?.();
            } else {
                toast.error(fulfillment.message ?? t`Failed to update fulfillment state`);
            }
        },
        onError: error => {
            toast.error(t`Failed to update fulfillment state`);
        },
    });

    const nextSuggestedState = (): string | undefined => {
        const { nextStates } = fulfillment;
        const namedStateOrDefault = (targetState: string) =>
            nextStates.includes(targetState) ? targetState : nextStates[0];

        switch (fulfillment.state) {
            case 'Pending':
                return namedStateOrDefault('Shipped');
            case 'Shipped':
                return namedStateOrDefault('Delivered');
            default:
                return nextStates.find(s => s !== 'Cancelled');
        }
    };

    const nextOtherStates = (): string[] => {
        const suggested = nextSuggestedState();
        return fulfillment.nextStates.filter(s => s !== suggested);
    };

    const handleStateTransition = (state: string) => {
        transitionFulfillmentMutation.mutate({
            id: fulfillment.id,
            state,
        });
    };

    const getFulfillmentActions = () => {
        const actions = [];

        const suggested = nextSuggestedState();
        if (suggested) {
            const suggestedState = getTranslatedFulfillmentState(suggested);
            actions.push({
                label: t`Transition to ${suggestedState}`,
                onClick: () => handleStateTransition(suggested),
                disabled: transitionFulfillmentMutation.isPending,
            });
        }

        nextOtherStates().forEach(state => {
            actions.push({
                label: t`Transition to ${getTranslatedFulfillmentState(state)}`,
                tone: orderStateDictionary.toneFor(state),
                destructive: isDestructiveTransition(state),
                onClick: () => handleStateTransition(state),
                disabled: transitionFulfillmentMutation.isPending,
            });
        });

        return actions;
    };

    return (
        <div>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div
                    className="sm:col-start-2 sm:row-start-1 sm:justify-self-end"
                    data-testid="fulfillment-state-control"
                >
                    <StateTransitionControl
                        currentState={fulfillment.state}
                        statesTranslationFunction={getTranslatedFulfillmentState}
                        actions={getFulfillmentActions()}
                        isLoading={transitionFulfillmentMutation.isPending}
                    />
                </div>
                <div className="grid gap-2 md:grid-cols-2 sm:col-start-1 sm:row-start-1">
                    <LabeledData label={<Trans>Fulfillment ID</Trans>} value={fulfillment.id.slice(-8)} />
                    <LabeledData label={<Trans>Method</Trans>} value={fulfillment.method} />
                    {fulfillment.trackingCode && (
                        <LabeledData label={<Trans>Tracking code</Trans>} value={fulfillment.trackingCode} />
                    )}
                    <LabeledData label={<Trans>Created</Trans>} value={formatDate(fulfillment.createdAt)} />
                </div>
            </div>

            {fulfillment.lines.length > 0 && (
                <div className="mt-4">
                    <Dialog>
                        <DialogTrigger render={<Button variant="outline" size="sm" />}>
                            <Trans>
                                View fulfilled items (
                                {fulfillment.lines.reduce((acc, line) => acc + line.quantity, 0)})
                            </Trans>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                            <DialogHeader>
                                <DialogTitle>
                                    <Trans>Fulfilled items</Trans>
                                </DialogTitle>
                                <DialogDescription>
                                    <Trans>Items included in this fulfillment.</Trans>
                                </DialogDescription>
                            </DialogHeader>
                            <div className="overflow-auto flex-1 divide-y">
                                {fulfillment.lines.map(line => {
                                    const orderLine = orderLinesMap.get(line.orderLineId);
                                    const productName = orderLine?.productVariant?.name ?? t`Unknown product`;
                                    const sku = orderLine?.productVariant?.sku;

                                    return (
                                        <div key={line.orderLineId} className="py-3 first:pt-0 last:pb-0">
                                            <div className="font-medium text-sm">{productName}</div>
                                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                                <span>
                                                    <Trans>Quantity: {line.quantity}</Trans>
                                                </span>
                                                {sku && <span>SKU: {sku}</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            )}

            {customFieldConfig.length > 0 && (
                <div className="mt-4">
                    <Form {...customFieldsForm}>
                        <CustomFieldsForm
                            entityType="Fulfillment"
                            control={customFieldsForm.control}
                            disabled
                        />
                    </Form>
                </div>
            )}
        </div>
    );
}
