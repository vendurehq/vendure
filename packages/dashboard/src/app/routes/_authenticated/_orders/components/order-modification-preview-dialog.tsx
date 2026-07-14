import { MoneyInput } from '@/vdb/components/data-input/money-input.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Alert, AlertDescription, AlertTitle } from '@/vdb/components/ui/alert.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/vdb/components/ui/card.js';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Textarea } from '@/vdb/components/ui/textarea.js';
import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { api } from '@/vdb/graphql/api.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { ResultOf, VariablesOf } from 'gql.tada';
import { CheckIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Form } from '@/vdb/components/ui/form.js';
import { modifyOrderDocument, orderDetailDocument } from '../orders.graphql.js';
import { OrderTable } from './order-table.js';

export type OrderFragment = NonNullable<ResultOf<typeof orderDetailDocument>['order']>;
export type ModifyOrderInput = VariablesOf<typeof modifyOrderDocument>['input'];

interface OrderModificationPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    orderSnapshot: OrderFragment;
    modifyOrderInput: ModifyOrderInput;
    /**
     * The price difference between the order snapshot and the preview order.
     * If the dialog is cancelled, this will be undefined.
     */
    onResolve: (priceDifference?: number) => void;
}

interface PaymentRefundForm {
    payments: Record<string, number>;
    note: string;
}

export function OrderModificationPreviewDialog({
    open,
    onOpenChange,
    orderSnapshot,
    modifyOrderInput,
    onResolve,
}: Readonly<OrderModificationPreviewDialogProps>) {
    const { t } = useLingui();
    const { formatCurrency } = useLocalFormat();
    // Use a ref to track the last input sent to avoid duplicate calls
    const lastInputRef = useRef<ModifyOrderInput | null>(null);
    const previewMutation = useMutation({
        mutationFn: api.mutate(
            addCustomFields(modifyOrderDocument, { includeNestedFragments: ['OrderLine', 'Fulfillment'] }),
        ),
    });

    // Create form with dynamic fields for each payment
    const refundForm = useForm<PaymentRefundForm>({
        defaultValues: {
            note: '',
            payments:
                orderSnapshot.payments?.reduce(
                    (acc, payment) => {
                        acc[payment.id] = 0;
                        return acc;
                    },
                    {} as Record<string, number>,
                ) || {},
        },
    });

    const confirmMutation = useMutation({
        mutationFn: (input: ModifyOrderInput) =>
            api.mutate(
                addCustomFields(modifyOrderDocument, {
                    includeNestedFragments: ['OrderLine', 'Fulfillment'],
                }),
            )({ input }),
    });

    // Trigger preview when dialog opens or input changes (while open)
    useEffect(() => {
        if (open) {
            // Only trigger if input actually changed
            if (
                !lastInputRef.current ||
                JSON.stringify(lastInputRef.current) !== JSON.stringify(modifyOrderInput)
            ) {
                const input = { ...modifyOrderInput, dryRun: true };
                previewMutation.mutate({ input });
                lastInputRef.current = modifyOrderInput;
            }
        }
    }, [open, modifyOrderInput]);

    const previewOrder =
        previewMutation.data?.modifyOrder?.__typename === 'Order' ? previewMutation.data.modifyOrder : null;
    const error =
        previewMutation.data && previewMutation.data.modifyOrder?.__typename !== 'Order'
            ? previewMutation.data.modifyOrder?.message || t`Unknown error`
            : previewMutation.error?.message || null;
    const loading = previewMutation.isPending;

    // Price difference
    const priceDifference = previewOrder ? previewOrder.totalWithTax - orderSnapshot.totalWithTax : 0;
    const formattedDiff = previewOrder
        ? formatCurrency(Math.abs(priceDifference), previewOrder.currencyCode)
        : '';

    // Calculate total refund amount from form
    const totalRefundAmount =
        orderSnapshot.payments?.reduce((total, payment) => {
            const refundAmount = refundForm.watch(`payments.${payment.id}`) || 0;
            return total + refundAmount;
        }, 0) || 0;

    // Check if total refund matches the required amount
    const isRefundComplete = priceDifference > 0 || totalRefundAmount >= Math.abs(priceDifference);
    const remainingAmount = Math.abs(priceDifference) - totalRefundAmount;

    // Confirm handler
    const handleConfirm = async () => {
        if (!previewOrder) return;
        const input: ModifyOrderInput = { ...modifyOrderInput, dryRun: false };
        if (priceDifference < 0) {
            // Create refunds array from form data
            const { note, payments } = refundForm.getValues();
            const refunds = Object.entries(payments)
                .filter(([_, amount]) => amount > 0)
                .map(([paymentId, amount]) => ({
                    paymentId,
                    amount,
                    reason: note,
                }));

            input.refunds = refunds;
        }
        await confirmMutation.mutateAsync(input);
        onResolve(priceDifference);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="min-w-[80vw] max-h-[90vh] p-8 overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Preview order modifications</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>Review the changes before applying them to the order.</Trans>
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 flex-1 overflow-y-auto">
                    {loading && (
                        <div className="text-center py-8">
                            <Trans>Loading preview…</Trans>
                        </div>
                    )}
                    {error && <div className="text-destructive py-2">{error}</div>}
                    {previewOrder && !loading && !error && (
                        <>
                            <OrderTable pageId="order-modification-preview" order={previewOrder} />
                            {/* Refund/payment UI using Alert */}
                            {priceDifference < 0 && (
                                <>
                                    <Alert variant="destructive">
                                        <AlertTitle>
                                            <Trans>Refund required</Trans>
                                        </AlertTitle>
                                        <AlertDescription>
                                            <Trans>
                                                A refund of {formattedDiff} is required. Select payment
                                                amounts and enter a note to proceed.
                                            </Trans>
                                        </AlertDescription>
                                    </Alert>
                                    <Form {...refundForm}>
                                        <form className="space-y-4 mt-4">
                                            {/* Payment Cards */}
                                            <div className="space-y-3">
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                    {orderSnapshot.payments?.map(payment => (
                                                        <Card key={payment.id} className="">
                                                            <CardHeader className="">
                                                                <CardTitle className="flex gap-2 items-baseline">
                                                                    <span className="">{payment.method}</span>
                                                                    <span className="text-xs text-muted-foreground">
                                                                        ID: {payment.transactionId}
                                                                    </span>
                                                                </CardTitle>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className=""
                                                                    onClick={() => {
                                                                        const currentRefundAmount =
                                                                            refundForm.getValues(
                                                                                `payments.${payment.id}`,
                                                                            ) || 0;
                                                                        const availableAmount =
                                                                            payment.amount;
                                                                        const remainingNeeded =
                                                                            Math.abs(priceDifference) -
                                                                            totalRefundAmount;

                                                                        // Calculate how much we can still refund from this payment method
                                                                        const remainingFromThisPayment =
                                                                            availableAmount -
                                                                            currentRefundAmount;

                                                                        // Take the minimum of what's needed and what's available
                                                                        const amountToAdd = Math.min(
                                                                            remainingFromThisPayment,
                                                                            remainingNeeded,
                                                                        );

                                                                        if (amountToAdd > 0) {
                                                                            refundForm.setValue(
                                                                                `payments.${payment.id}`,
                                                                                currentRefundAmount +
                                                                                    amountToAdd,
                                                                            );
                                                                        }
                                                                    }}
                                                                >
                                                                    <Trans>Refund from this method</Trans>
                                                                </Button>
                                                            </CardHeader>
                                                            <CardContent className="pt-0">
                                                                <div className="flex flex-col gap-3">
                                                                    <div className="text-sm text-muted-foreground">
                                                                        <Trans>Available:</Trans>{' '}
                                                                        {formatCurrency(
                                                                            payment.amount,
                                                                            orderSnapshot.currencyCode,
                                                                        )}
                                                                    </div>
                                                                    <div className="w-full">
                                                                        <Controller
                                                                            name={`payments.${payment.id}`}
                                                                            control={refundForm.control}
                                                                            render={({ field }) => (
                                                                                <MoneyInput
                                                                                    {...field}
                                                                                    value={field.value || 0}
                                                                                    onChange={field.onChange}
                                                                                    currency={
                                                                                        orderSnapshot.currencyCode
                                                                                    }
                                                                                />
                                                                            )}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </CardContent>
                                                        </Card>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Total Refund Summary */}
                                            <div className="bg-muted/50 rounded-lg pb-3">
                                                <div className="flex items-center justify-between p-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium">
                                                            <Trans>Total refund:</Trans>
                                                        </span>
                                                        <span className="text-sm">
                                                            {formatCurrency(
                                                                totalRefundAmount,
                                                                orderSnapshot.currencyCode,
                                                            )}
                                                        </span>
                                                        {isRefundComplete && (
                                                            <CheckIcon className="h-4 w-4 text-success" />
                                                        )}
                                                    </div>
                                                    {!isRefundComplete && (
                                                        <div className="text-sm text-muted-foreground">
                                                            <Trans>Remaining:</Trans>{' '}
                                                            {formatCurrency(
                                                                remainingAmount,
                                                                orderSnapshot.currencyCode,
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="px-3">
                                                    <FormFieldWrapper
                                                        name="note"
                                                        control={refundForm.control}
                                                        rules={{ required: true }}
                                                        render={({ field }) => (
                                                            <Textarea
                                                                {...field}
                                                                className="bg-background"
                                                                placeholder={t`Enter refund note`}
                                                            />
                                                        )}
                                                    />
                                                </div>
                                            </div>
                                        </form>
                                    </Form>
                                </>
                            )}
                            <div className="w-full flex justify-end">
                                <div className="max-w-l mb-2">
                                    {priceDifference > 0 && (
                                        <Alert variant="destructive">
                                            <AlertTitle>
                                                <Trans>Additional payment required</Trans>
                                            </AlertTitle>
                                            <AlertDescription>
                                                <Trans>
                                                    An additional payment of {formattedDiff} will be required.
                                                </Trans>
                                            </AlertDescription>
                                        </Alert>
                                    )}
                                    {priceDifference === 0 && (
                                        <Alert variant="default">
                                            <AlertTitle>
                                                <Trans>No payment or refund required</Trans>
                                            </AlertTitle>
                                            <AlertDescription>
                                                <Trans>
                                                    No payment or refund is required for these changes.
                                                </Trans>
                                            </AlertDescription>
                                        </Alert>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
                <DialogFooter>
                    <DialogClose
                        render={<Button type="button" variant="secondary" onClick={() => onResolve()} />}
                    >
                        <Trans>Cancel</Trans>
                    </DialogClose>
                    <Button
                        type="button"
                        variant="default"
                        onClick={handleConfirm}
                        disabled={loading || !!error || confirmMutation.isPending || !isRefundComplete}
                    >
                        <Trans>Confirm</Trans>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
