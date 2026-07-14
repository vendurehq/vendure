import {
    RelationSelector,
    createRelationSelectorConfig,
} from '@/vdb/components/data-input/relation-selector.js';
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
import { api } from '@/vdb/graphql/api.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { addManualPaymentToOrderDocument, paymentMethodsDocument } from '../orders.graphql.js';
import { Order } from '../utils/order-types.js';
import { calculateOutstandingPaymentAmount } from '../utils/order-utils.js';

interface AddManualPaymentDialogProps {
    order: Order;
    onSuccess?: () => void;
}

interface FormData {
    method: string;
    transactionId: string;
}

export function AddManualPaymentDialog({ order, onSuccess }: Readonly<AddManualPaymentDialogProps>) {
    const { t } = useLingui();
    const { formatCurrency } = useLocalFormat();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [open, setOpen] = useState(false);

    const addManualPaymentMutation = useMutation({
        mutationFn: api.mutate(addManualPaymentToOrderDocument),
        onSuccess: (result: any) => {
            const { addManualPaymentToOrder } = result;
            if (addManualPaymentToOrder.__typename === 'Order') {
                toast(t`Successfully added payment to order`);
                onSuccess?.();
            } else {
                toast(t`Failed to add payment`, {
                    description: addManualPaymentToOrder.message,
                });
            }
        },
        onError: error => {
            toast(t`Failed to add payment`, {
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        },
    });

    const form = useForm<FormData>({
        defaultValues: {
            method: '',
            transactionId: '',
        },
    });
    const method = form.watch('method');

    const handleSubmit = async (data: FormData) => {
        setIsSubmitting(true);
        try {
            addManualPaymentMutation.mutate({
                input: {
                    orderId: order.id,
                    method: data.method,
                    transactionId: data.transactionId,
                    metadata: {},
                },
            });
            setOpen(false);
            form.reset();
        } catch (error) {
            toast(t`Failed to add payment`, {
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCancel = () => {
        form.reset();
        setOpen(false);
    };

    const outstandingAmount = calculateOutstandingPaymentAmount(order);
    const currencyCode = order.currencyCode;

    // Create relation selector config for payment methods
    const paymentMethodSelectorConfig = createRelationSelectorConfig({
        listQuery: paymentMethodsDocument,
        idKey: 'code',
        labelKey: 'name',
        placeholder: t`Search payment methods...`,
        multiple: false,
        label: (method: any) => `${method.name} (${method.code})`,
    });

    return (
        <>
            <Button
                onClick={e => {
                    e.stopPropagation();
                    setOpen(true);
                }}
                className="mr-2"
            >
                <Trans>Add payment</Trans>
            </Button>
            <Dialog open={open}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>
                            <Trans>Add payment to order</Trans>
                        </DialogTitle>
                        <DialogDescription>
                            <Trans>
                                Add a manual payment of {formatCurrency(outstandingAmount, currencyCode)}
                            </Trans>
                        </DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                        <form
                            onSubmit={e => {
                                e.stopPropagation();
                                form.handleSubmit(handleSubmit)(e);
                            }}
                            className="space-y-4"
                        >
                            <FormFieldWrapper
                                control={form.control}
                                name="method"
                                label={<Trans>Payment method</Trans>}
                                rules={{ required: t`Payment method is required` }}
                                render={({ field }) => (
                                    <RelationSelector
                                        config={paymentMethodSelectorConfig}
                                        value={field.value}
                                        onChange={field.onChange}
                                        disabled={isSubmitting}
                                    />
                                )}
                            />
                            <FormFieldWrapper
                                control={form.control}
                                name="transactionId"
                                label={<Trans>Transaction ID</Trans>}
                                rules={{ required: t`Transaction ID is required` }}
                                render={({ field }) => (
                                    <Input {...field} placeholder={t`Enter transaction ID`} />
                                )}
                            />
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={handleCancel}>
                                    <Trans>Cancel</Trans>
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={!form.formState.isValid || isSubmitting || !method}
                                >
                                    {isSubmitting ? (
                                        <Trans>Adding...</Trans>
                                    ) : (
                                        <Trans>
                                            Add payment ({formatCurrency(outstandingAmount, currencyCode)})
                                        </Trans>
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
