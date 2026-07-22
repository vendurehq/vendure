import { ConfigurableOperationInput } from '@/vdb/components/shared/configurable-operation-input.js';
import { getInitialConfigArgValue } from '@/vdb/components/shared/configurable-operation-utils.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Label } from '@/vdb/components/ui/label.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ConfigurableOperationInput as ConfigurableOperationInputType } from '@vendure/common/lib/generated-types';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { fulfillmentHandlersDocument, fulfillOrderDocument } from '../orders.graphql.js';
import { Order } from '../utils/order-types.js';

interface FulfillOrderDialogProps {
    order: Order;
    onSuccess?: () => void;
}

interface FormData {
    handler: ConfigurableOperationInputType;
}

interface FulfillmentQuantity {
    fulfillCount: number;
    max: number;
}

export function FulfillOrderDialog({ order, onSuccess }: Readonly<FulfillOrderDialogProps>) {
    const { t } = useLingui();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [open, setOpen] = useState(false);
    const [fulfillmentQuantities, setFulfillmentQuantities] = useState<{
        [lineId: string]: FulfillmentQuantity;
    }>({});
    const [handlerArgsValid, setHandlerArgsValid] = useState(true);

    // Get fulfillment handlers
    const { data: fulfillmentHandlersData } = useQuery({
        queryKey: ['fulfillmentHandlers'],
        queryFn: () => api.query(fulfillmentHandlersDocument),
        staleTime: 1000 * 60 * 60 * 5,
    });

    // Get global settings for inventory tracking
    const { data: globalSettingsData } = useQuery({
        queryKey: ['globalSettings'],
        queryFn: () =>
            api.query(
                graphql(`
                    query GetGlobalSettings {
                        globalSettings {
                            trackInventory
                        }
                    }
                `),
            ),
        staleTime: 1000 * 60 * 60 * 5,
    });

    const fulfillOrderMutation = useMutation({
        mutationFn: api.mutate(fulfillOrderDocument),
        onSuccess: (result: any) => {
            const { addFulfillmentToOrder } = result;
            if (addFulfillmentToOrder.__typename === 'Fulfillment') {
                toast(t`Successfully fulfilled order`);
                onSuccess?.();
            } else {
                toast(t`Failed to fulfill order`, {
                    description: addFulfillmentToOrder.message,
                });
            }
        },
        onError: error => {
            toast(t`Failed to fulfill order`, {
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        },
    });

    const form = useForm<FormData>({
        defaultValues: {
            handler: {
                code: '',
                arguments: [],
            },
        },
    });

    // Initialize fulfillment quantities when dialog opens
    const initializeFulfillmentQuantities = () => {
        if (!globalSettingsData?.globalSettings) return;

        const quantities: { [lineId: string]: FulfillmentQuantity } = {};
        order.lines.forEach(line => {
            const fulfillCount = getFulfillableCount(line, globalSettingsData.globalSettings.trackInventory);
            quantities[line.id] = { fulfillCount, max: fulfillCount };
        });
        setFulfillmentQuantities(quantities);

        // Set default fulfillment handler
        const defaultHandler =
            fulfillmentHandlersData?.fulfillmentHandlers.find(
                h => h.code === order.shippingLines[0]?.shippingMethod?.fulfillmentHandlerCode,
            ) ?? fulfillmentHandlersData?.fulfillmentHandlers[0];

        if (defaultHandler) {
            form.setValue('handler', {
                code: defaultHandler.code,
                arguments: defaultHandler.args.map(arg => ({
                    name: arg.name,
                    value: getInitialConfigArgValue(arg),
                })),
            });
        }
    };

    const getFulfillableCount = (line: Order['lines'][number], globalTrackInventory: boolean): number => {
        const { trackInventory, stockOnHand } = line.productVariant;
        const effectiveTrackInventory =
            trackInventory === 'INHERIT' ? globalTrackInventory : trackInventory === 'TRUE';

        const unfulfilledCount = getUnfulfilledCount(line);
        return effectiveTrackInventory ? Math.min(unfulfilledCount, stockOnHand) : unfulfilledCount;
    };

    const getUnfulfilledCount = (line: Order['lines'][number]): number => {
        const fulfilled =
            order.fulfillments
                ?.filter(f => f.state !== 'Cancelled')
                .map(f => f.lines)
                .flat()
                .filter(row => row.orderLineId === line.id)
                .reduce((sum, row) => sum + row.quantity, 0) ?? 0;
        return line.quantity - fulfilled;
    };

    const updateFulfillmentQuantity = (lineId: string, fulfillCount: number) => {
        setFulfillmentQuantities(prev => ({
            ...prev,
            [lineId]: { ...prev[lineId], fulfillCount },
        }));
    };

    const canSubmit = (): boolean => {
        const totalCount = Object.values(fulfillmentQuantities).reduce(
            (total, { fulfillCount }) => total + fulfillCount,
            0,
        );
        const fulfillmentQuantityIsValid = Object.values(fulfillmentQuantities).every(
            ({ fulfillCount, max }) => fulfillCount <= max && fulfillCount >= 0,
        );
        const formIsValid = form.formState.isValid;
        return formIsValid && totalCount > 0 && fulfillmentQuantityIsValid && handlerArgsValid;
    };

    const handleSubmit = async (data: FormData) => {
        setIsSubmitting(true);
        try {
            const lines = Object.entries(fulfillmentQuantities)
                .filter(([, { fulfillCount }]) => fulfillCount > 0)
                .map(([orderLineId, { fulfillCount }]) => ({
                    orderLineId,
                    quantity: fulfillCount,
                }));

            fulfillOrderMutation.mutate({
                input: {
                    lines,
                    handler: data.handler,
                },
            });
            setOpen(false);
            form.reset();
            setFulfillmentQuantities({});
        } catch (error) {
            toast(t`Failed to fulfill order`, {
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCancel = () => {
        form.reset();
        setFulfillmentQuantities({});
        setHandlerArgsValid(true);
        setOpen(false);
    };

    const handleOpen = () => {
        setOpen(true);
        // Initialize quantities after a short delay to ensure data is loaded
        setTimeout(initializeFulfillmentQuantities, 100);
    };

    const fulfillmentHandlers = fulfillmentHandlersData?.fulfillmentHandlers;
    const selectedHandler = fulfillmentHandlers?.find(h => h.code === form.watch('handler.code'));

    return (
        <>
            <Button
                onClick={e => {
                    e.stopPropagation();
                    handleOpen();
                }}
                className="mr-2"
            >
                <Trans>Fulfill order</Trans>
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle>
                            <Trans>Fulfill order</Trans>
                        </DialogTitle>
                        <DialogDescription>
                            <Trans>Select quantities to fulfill and configure the fulfillment handler</Trans>
                        </DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                        <form
                            onSubmit={e => {
                                e.stopPropagation();
                                form.handleSubmit(handleSubmit)(e);
                            }}
                            className="space-y-4 flex-1 overflow-hidden flex flex-col"
                        >
                            <div className="space-y-4 flex-1 overflow-y-auto">
                                <div className="font-medium">
                                    <Trans>Order lines</Trans>
                                </div>
                                {order.lines.map(line => {
                                    const quantity = fulfillmentQuantities[line.id];
                                    if (!quantity || quantity.max <= 0) return null;

                                    return (
                                        <div
                                            key={line.id}
                                            className="flex items-center justify-between p-3 border rounded-md"
                                        >
                                            <div className="flex-1">
                                                <div className="font-medium">{line.productVariant.name}</div>
                                                <div className="text-sm text-muted-foreground">
                                                    SKU: {line.productVariant.sku}
                                                </div>
                                                <div className="text-sm text-muted-foreground">
                                                    <Trans>
                                                        {quantity.max} of {line.quantity} available to fulfill
                                                    </Trans>
                                                </div>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <Label htmlFor={`quantity-${line.id}`}>
                                                    <Trans>Quantity</Trans>
                                                </Label>
                                                <Input
                                                    id={`quantity-${line.id}`}
                                                    type="number"
                                                    min="0"
                                                    max={quantity.max}
                                                    value={quantity.fulfillCount}
                                                    data-testid="fulfill-quantity"
                                                    onChange={e => {
                                                        const value = Number.parseInt(e.target.value) || 0;
                                                        updateFulfillmentQuantity(line.id, value);
                                                    }}
                                                    className="w-20"
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {selectedHandler && (
                                <FormFieldWrapper
                                    control={form.control}
                                    name="handler"
                                    label={<Trans>Fulfillment handler</Trans>}
                                    render={({ field }) => (
                                        <ConfigurableOperationInput
                                            operationDefinition={selectedHandler}
                                            value={
                                                field.value ?? { code: selectedHandler.code, arguments: [] }
                                            }
                                            onChange={field.onChange}
                                            readonly={false}
                                            removable={false}
                                            onValidityChange={setHandlerArgsValid}
                                        />
                                    )}
                                />
                            )}

                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={handleCancel}>
                                    <Trans>Cancel</Trans>
                                </Button>
                                <Button type="submit" disabled={!canSubmit() || isSubmitting}>
                                    {isSubmitting ? (
                                        <Trans>Fulfilling...</Trans>
                                    ) : (
                                        <Trans>Fulfill order</Trans>
                                    )}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
        </>
    );
}
