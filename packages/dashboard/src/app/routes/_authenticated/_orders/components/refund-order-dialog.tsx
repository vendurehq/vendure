import { VendureImage } from '@/vdb/components/shared/vendure-image.js';
import { Alert, AlertDescription } from '@/vdb/components/ui/alert.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Label } from '@/vdb/components/ui/label.js';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/vdb/components/ui/select.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { AlertCircle } from 'lucide-react';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { uiConfig } from 'virtual:vendure-ui-config';

import { useRefundOrder } from '../hooks/use-refund-order.js';
import { Order } from '../utils/order-types.js';
import { getMaxRefundableQuantity, lineCanBeRefunded } from '../utils/order-utils.js';

interface RefundOrderDialogProps {
    readonly order: Order;
    readonly onSuccess?: () => void;
}

export interface RefundOrderDialogRef {
    open: () => void;
}

export const RefundOrderDialog = forwardRef<RefundOrderDialogRef, RefundOrderDialogProps>(
    function RefundOrderDialog({ order, onSuccess }, ref) {
        const { t } = useLingui();
        const { getTranslatedRefundReason } = useDynamicTranslations();
        const { formatCurrency, toMajorUnits, toMinorUnits } = useLocalFormat();
        const [open, setOpen] = useState(false);

        const refund = useRefundOrder(order, () => {
            setOpen(false);
            onSuccess?.();
        });

        useImperativeHandle(ref, () => ({
            open: () => {
                refund.resetState();
                setOpen(true);
            },
        }));

        const { refundReasons } = uiConfig.orders;

        const handleClose = () => {
            setOpen(false);
        };

        return (
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="!max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            <Trans>Refund and cancel order</Trans>
                        </DialogTitle>
                        <DialogDescription>
                            <Trans>Select items to refund and optionally return to stock</Trans>
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6">
                        {/* Order Lines Table */}
                        <div className="space-y-2">
                            <Label className="text-base font-medium">
                                <Trans>Order lines</Trans>
                            </Label>
                            <div className="border rounded-md overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted">
                                        <tr>
                                            <th className="p-2 text-left w-16">
                                                <Trans>Image</Trans>
                                            </th>
                                            <th className="p-2 text-left">
                                                <Trans>Product</Trans>
                                            </th>
                                            <th className="p-2 text-right">
                                                <Trans>Unit price</Trans>
                                            </th>
                                            <th className="p-2 text-center">
                                                <Trans>Qty</Trans>
                                            </th>
                                            <th className="p-2 text-center w-24">
                                                <Trans>Refund</Trans>
                                            </th>
                                            <th className="p-2 text-center">
                                                <Trans>Return to stock</Trans>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {order.lines.map(line => {
                                            const canRefund = lineCanBeRefunded(order, line);
                                            const maxRefundable = getMaxRefundableQuantity(order, line);
                                            const selection = refund.lineSelections[line.id];

                                            if (!canRefund) return null;

                                            return (
                                                <tr key={line.id} className="border-t">
                                                    <td className="p-2">
                                                        <VendureImage
                                                            asset={line.featuredAsset}
                                                            preset="tiny"
                                                            className="w-10 h-10 object-cover"
                                                        />
                                                    </td>
                                                    <td className="p-2">
                                                        <div className="font-medium">
                                                            {line.productVariant.name}
                                                        </div>
                                                        <div className="text-muted-foreground text-xs">
                                                            <Trans>SKU:</Trans> {line.productVariant.sku}
                                                        </div>
                                                    </td>
                                                    <td className="p-2 text-right">
                                                        {formatCurrency(
                                                            line.proratedUnitPriceWithTax,
                                                            order.currencyCode,
                                                        )}
                                                    </td>
                                                    <td className="p-2 text-center">
                                                        {line.orderPlacedQuantity}
                                                        {maxRefundable < line.orderPlacedQuantity && (
                                                            <div className="text-xs text-muted-foreground">
                                                                <Trans>({maxRefundable} refundable)</Trans>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="p-2 text-center">
                                                        <Input
                                                            type="number"
                                                            min={0}
                                                            max={maxRefundable}
                                                            value={selection?.quantity || ''}
                                                            placeholder="0"
                                                            data-testid="refund-quantity"
                                                            onChange={e => {
                                                                const value = Math.min(
                                                                    Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                                                                    maxRefundable,
                                                                );
                                                                refund.onRefundQuantityChange(line.id, value);
                                                            }}
                                                            className="w-20 text-right"
                                                        />
                                                    </td>
                                                    <td className="p-2 text-center">
                                                        <div className="flex items-center justify-center">
                                                            <Checkbox
                                                                checked={selection?.cancel ?? false}
                                                                disabled={!selection?.quantity}
                                                                onCheckedChange={checked =>
                                                                    refund.onCancelChange(line.id, !!checked)
                                                                }
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Shipping Refund */}
                        {order.shippingLines.length > 0 && (
                            <div className="space-y-2">
                                <Label className="text-base font-medium">
                                    <Trans>Shipping</Trans>
                                </Label>
                                <div className="space-y-2">
                                    {order.shippingLines.map(shippingLine => (
                                        <div key={shippingLine.id} className="flex items-center gap-2">
                                            <Checkbox
                                                checked={refund.refundShippingLineIds.includes(shippingLine.id)}
                                                onCheckedChange={() =>
                                                    refund.toggleShippingRefund(shippingLine.id)
                                                }
                                            />
                                            <Label className="font-normal">
                                                <Trans>Refund shipping</Trans>:{' '}
                                                {shippingLine.shippingMethod?.name} -{' '}
                                                {formatCurrency(
                                                    shippingLine.discountedPriceWithTax,
                                                    order.currencyCode,
                                                )}
                                            </Label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Reason Selection */}
                        <div className="space-y-2">
                            <Label className="text-base font-medium">
                                <Trans>Reason</Trans>
                            </Label>
                            <Select
                                items={Object.fromEntries(refundReasons.map(r => [r.value, getTranslatedRefundReason(r.label)]))}
                                value={refund.selectedReason}
                                onValueChange={(value) => { if (value != null) refund.setSelectedReason(value) }}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder={t`Select a reason...`} />
                                </SelectTrigger>
                                <SelectContent>
                                    {refundReasons.map(reasonOption => (
                                        <SelectItem key={reasonOption.value} value={reasonOption.value}>
                                            {getTranslatedRefundReason(reasonOption.label)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {refund.selectedReason === 'other' && (
                                <Input
                                    placeholder={t`Enter custom reason...`}
                                    value={refund.customReason}
                                    onChange={e => refund.setCustomReason(e.target.value)}
                                    className="mt-2"
                                />
                            )}
                        </div>

                        {/* Refund Total */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Label className="text-base font-medium">
                                    <Trans>Refund total</Trans>
                                </Label>
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        checked={refund.manuallySetRefundTotal}
                                        onCheckedChange={checked => {
                                            refund.setManuallySetRefundTotal(!!checked);
                                            if (!checked) {
                                                const calculated = refund.recalculateRefundTotal();
                                                refund.onManualRefundTotalChange(calculated);
                                            }
                                        }}
                                    />
                                    <Label className="font-normal text-sm text-muted-foreground">
                                        <Trans>Override</Trans>
                                    </Label>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="number"
                                    step="0.01"
                                    value={toMajorUnits(refund.refundTotal)}
                                    onChange={e =>
                                        refund.onManualRefundTotalChange(
                                            toMinorUnits(Number.parseFloat(e.target.value) || 0),
                                        )
                                    }
                                    disabled={!refund.manuallySetRefundTotal}
                                    className="w-32"
                                />
                                <span className="text-muted-foreground">{order.currencyCode}</span>
                                <span className="text-muted-foreground text-sm">
                                    <Trans>(max: {formatCurrency(refund.totalRefundableAmount, order.currencyCode)})</Trans>
                                </span>
                            </div>
                        </div>

                        {/* Payment Selection */}
                        <div className="space-y-2">
                            <Label className="text-base font-medium">
                                <Trans>Select payments to refund</Trans>
                            </Label>
                            <div className="space-y-3">
                                {refund.refundablePayments.map(payment => (
                                    <div key={payment.id} className="border rounded-md p-3 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Checkbox
                                                    checked={payment.selected}
                                                    onCheckedChange={checked =>
                                                        refund.onPaymentSelected(payment.id, !!checked)
                                                    }
                                                />
                                                <div>
                                                    <div className="font-medium">{payment.method}</div>
                                                    <div className="text-sm text-muted-foreground">
                                                        <Trans>Available</Trans>:{' '}
                                                        {formatCurrency(
                                                            payment.refundableAmount,
                                                            order.currencyCode,
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            {payment.selected && (
                                                <div className="flex items-center gap-2">
                                                    <Label className="text-sm">
                                                        <Trans>Amount</Trans>:
                                                    </Label>
                                                    <Input
                                                        type="number"
                                                        step="0.01"
                                                        value={toMajorUnits(payment.amountToRefund)}
                                                        onChange={e =>
                                                            refund.onPaymentAmountChange(
                                                                payment.id,
                                                                toMinorUnits(Number.parseFloat(e.target.value) || 0),
                                                            )
                                                        }
                                                        className="w-24"
                                                        max={toMajorUnits(payment.refundableAmount)}
                                                    />
                                                    <span className="text-muted-foreground text-sm">
                                                        {order.currencyCode}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Validation Errors */}
                        {refund.validationErrors.length > 0 && (
                            <div className="space-y-2">
                                {refund.validationErrors.map(error => (
                                    <Alert key={error} variant="destructive">
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertDescription>{error}</AlertDescription>
                                    </Alert>
                                ))}
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={handleClose} disabled={refund.isSubmitting}>
                            <Trans>Cancel</Trans>
                        </Button>
                        <Button
                            onClick={() => void refund.handleSubmit()}
                            disabled={!refund.canSubmit || refund.isSubmitting}
                        >
                            {refund.isSubmitting ? (
                                <Trans>Processing...</Trans>
                            ) : (
                                <Trans>
                                    Refund {formatCurrency(refund.amountToRefundTotal, order.currencyCode)}
                                </Trans>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    },
);
