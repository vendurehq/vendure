import { Money } from '@/vdb/components/data-display/money.js';
import { Alert, AlertDescription, AlertTitle } from '@/vdb/components/ui/alert.js';
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldLabel,
    FieldLegend,
    FieldSet,
    FieldTitle,
} from '@/vdb/components/ui/field.js';
import { RadioGroup, RadioGroupItem } from '@/vdb/components/ui/radio-group.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { Trans } from '@lingui/react/macro';
import type { ReactNode } from 'react';

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
        amountWithTax == null ? (
            <>
                <span aria-hidden="true">—</span>
                <span className="sr-only">
                    <Trans>None</Trans>
                </span>
            </>
        ) : (
            <Money value={amountWithTax} currency={currencyCode} />
        );
    const options: Array<{ value: PromotionFreezeChoiceValue; title: ReactNode; total: number }> = [
        {
            value: 'keep',
            title: <Trans>Keep the discounts the order was paid with</Trans>,
            total: keptTotalWithTax,
        },
        {
            value: 'reapply',
            title: <Trans>Re-apply the promotions to the modified order</Trans>,
            total: reappliedTotalWithTax,
        },
    ];
    return (
        <div className="space-y-4" data-testid="promotion-freeze-choice">
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
                </TableBody>
            </Table>
            <FieldSet>
                <FieldLegend variant="label">
                    <Trans>Discounts for the modified order</Trans>
                </FieldLegend>
                <RadioGroup
                    value={value ?? ''}
                    onValueChange={next => onChange(next as PromotionFreezeChoiceValue)}
                    className="grid gap-3 md:grid-cols-2"
                >
                    {options.map(option => {
                        const id = `promotion-freeze-${option.value}`;
                        return (
                            <FieldLabel key={option.value} htmlFor={id}>
                                <Field orientation="horizontal">
                                    <FieldContent>
                                        <FieldTitle>{option.title}</FieldTitle>
                                        <FieldDescription>
                                            <Trans>Order total</Trans>{' '}
                                            <Money value={option.total} currency={currencyCode} />
                                        </FieldDescription>
                                    </FieldContent>
                                    <RadioGroupItem value={option.value} id={id} />
                                </Field>
                            </FieldLabel>
                        );
                    })}
                </RadioGroup>
            </FieldSet>
        </div>
    );
}
