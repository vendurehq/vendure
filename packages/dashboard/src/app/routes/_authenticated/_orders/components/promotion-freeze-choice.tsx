import { Money } from '@/vdb/components/data-display/money.js';
import { Alert, AlertDescription, AlertTitle } from '@/vdb/components/ui/alert.js';
import { Field, FieldLabel } from '@/vdb/components/ui/field.js';
import { RadioGroup, RadioGroupItem } from '@/vdb/components/ui/radio-group.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { Trans } from '@lingui/react/macro';

import { DiscountComparisonRow } from '../utils/order-utils.js';

/**
 * `keep` keeps the discounts the Order was paid with, `reapply` re-applies the promotions to the
 * modified Order.
 */
export type PromotionFreezeChoiceValue = 'keep' | 'reapply';

interface PromotionFreezeChoiceProps {
    rows: DiscountComparisonRow[];
    keptTotalWithTax: number;
    reappliedTotalWithTax: number;
    currencyCode: string;
    value: PromotionFreezeChoiceValue | null;
    onChange: (value: PromotionFreezeChoiceValue) => void;
}

/**
 * Shown in the modification preview when re-applying the promotions would change the discounts
 * of the Order, so that the administrator decides which discounts the modified Order gets.
 */
export function PromotionFreezeChoice({
    rows,
    keptTotalWithTax,
    reappliedTotalWithTax,
    currencyCode,
    value,
    onChange,
}: Readonly<PromotionFreezeChoiceProps>) {
    const amount = (amountWithTax: number | null) =>
        amountWithTax == null ? '—' : <Money value={amountWithTax} currency={currencyCode} />;
    return (
        <div className="space-y-3" data-testid="promotion-freeze-choice">
            <Alert>
                <AlertTitle>
                    <Trans>Discounts would change</Trans>
                </AlertTitle>
                <AlertDescription>
                    <Trans>
                        Re-applying the promotions to the modified order would change its discounts. Choose
                        which discounts the order should have.
                    </Trans>
                </AlertDescription>
            </Alert>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>
                            <Trans>Discount</Trans>
                        </TableHead>
                        <TableHead className="text-right">
                            <Trans>Keep original discounts</Trans>
                        </TableHead>
                        <TableHead className="text-right">
                            <Trans>Re-apply promotions</Trans>
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map(row => (
                        <TableRow key={row.adjustmentSource}>
                            <TableCell>{row.description}</TableCell>
                            <TableCell className="text-right">{amount(row.keptAmountWithTax)}</TableCell>
                            <TableCell className="text-right">{amount(row.reappliedAmountWithTax)}</TableCell>
                        </TableRow>
                    ))}
                    <TableRow>
                        <TableCell className="font-medium">
                            <Trans>Order total</Trans>
                        </TableCell>
                        <TableCell className="text-right font-medium">{amount(keptTotalWithTax)}</TableCell>
                        <TableCell className="text-right font-medium">
                            {amount(reappliedTotalWithTax)}
                        </TableCell>
                    </TableRow>
                </TableBody>
            </Table>
            <RadioGroup
                value={value ?? ''}
                onValueChange={next => onChange(next as PromotionFreezeChoiceValue)}
                className="gap-2"
            >
                <Field orientation="horizontal" className="gap-2">
                    <RadioGroupItem value="keep" id="promotion-freeze-keep" />
                    <FieldLabel htmlFor="promotion-freeze-keep" className="font-normal">
                        <Trans>Keep the discounts the order was paid with</Trans>
                    </FieldLabel>
                </Field>
                <Field orientation="horizontal" className="gap-2">
                    <RadioGroupItem value="reapply" id="promotion-freeze-reapply" />
                    <FieldLabel htmlFor="promotion-freeze-reapply" className="font-normal">
                        <Trans>Re-apply the promotions to the modified order</Trans>
                    </FieldLabel>
                </Field>
            </RadioGroup>
        </div>
    );
}
