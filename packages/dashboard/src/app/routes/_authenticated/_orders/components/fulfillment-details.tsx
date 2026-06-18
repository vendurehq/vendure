import { LabeledData } from '@/vdb/components/labeled-data.js';
import { CustomFieldsForm } from '@/vdb/components/shared/custom-fields-form.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/vdb/components/ui/collapsible.js';
import { Form } from '@/vdb/components/ui/form.js';
import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { useCustomFieldConfig } from '@/vdb/hooks/use-custom-field-config.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
    fulfillmentFragment,
    orderDetailFragment,
    transitionFulfillmentToStateDocument,
} from '../orders.graphql.js';
import { getTypeForState, StateTransitionControl } from './state-transition-control.js';

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
                type: getTypeForState(state),
                onClick: () => handleStateTransition(state),
                disabled: transitionFulfillmentMutation.isPending,
            });
        });

        return actions;
    };

    return (
        <div className="space-y-1 p-3 border rounded-md">
            <div className="space-y-1">
                <LabeledData label={<Trans>Fulfillment ID</Trans>} value={fulfillment.id.slice(-8)} />
                <LabeledData label={<Trans>Method</Trans>} value={fulfillment.method} />
                <LabeledData
                    label={<Trans>State</Trans>}
                    value={getTranslatedFulfillmentState(fulfillment.state)}
                />
                {fulfillment.trackingCode && (
                    <LabeledData label={<Trans>Tracking code</Trans>} value={fulfillment.trackingCode} />
                )}
                <LabeledData label={<Trans>Created</Trans>} value={formatDate(fulfillment.createdAt)} />
            </div>

            {fulfillment.lines.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                    <Collapsible>
                        <CollapsibleTrigger className="flex items-center justify-between w-full text-sm hover:underline text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md p-1 -m-1">
                            <Trans>
                                Fulfilled items (
                                {fulfillment.lines.reduce((acc, line) => acc + line.quantity, 0)})
                            </Trans>
                            <ChevronDown className="h-4 w-4 transition-transform duration-200 data-[state=open]:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2 space-y-1">
                            {fulfillment.lines.map(line => {
                                const orderLine = orderLinesMap.get(line.orderLineId);
                                const productName = orderLine?.productVariant?.name ?? 'Unknown product';
                                const sku = orderLine?.productVariant?.sku;

                                return (
                                    <div key={line.orderLineId} className="text-sm text-muted-foreground">
                                        <div className="font-medium text-foreground text-xs">
                                            {productName}
                                        </div>
                                        <div className="flex items-center gap-2 text-xs">
                                            <span>Qty: {line.quantity}</span>
                                            {sku && <span>SKU: {sku}</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </CollapsibleContent>
                    </Collapsible>
                </div>
            )}

            {customFieldConfig.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                    <Form {...customFieldsForm}>
                        <CustomFieldsForm
                            entityType="Fulfillment"
                            control={customFieldsForm.control}
                            disabled
                        />
                    </Form>
                </div>
            )}

            <div className="mt-3 pt-3 border-t">
                <StateTransitionControl
                    currentState={fulfillment.state}
                    statesTranslationFunction={getTranslatedFulfillmentState}
                    actions={getFulfillmentActions()}
                    isLoading={transitionFulfillmentMutation.isPending}
                />
            </div>
        </div>
    );
}
