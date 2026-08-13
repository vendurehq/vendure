import { MoneyInput } from '@/vdb/components/data-input/money-input.js';
import { Field, FieldError } from '@/vdb/components/ui/field.js';
import { Input } from '@/vdb/components/ui/input.js';
import { TableCell } from '@/vdb/components/ui/table.js';
import { VariablesOf } from '@/vdb/graphql/graphql.js';
import { z } from '@/vdb/lib/zod.js';
import { useLingui } from '@lingui/react/macro';
import { Control, Controller } from 'react-hook-form';
import { createProductVariantsDocument } from '../products.graphql.js';
import { GeneratedVariant } from '../utils/variant-combinations.js';

type CreateProductVariantInput = VariablesOf<typeof createProductVariantsDocument>['input'][number];
type VariantTranslationLanguageCode = NonNullable<CreateProductVariantInput['translations']>[number]['languageCode'];

const variantFieldSchema = z
    .object({
        enabled: z.boolean(),
        sku: z.string(),
        price: z.string(),
        stock: z.string(),
    })
    .superRefine((data, ctx) => {
        if (!data.enabled) return;
        if (!data.sku || data.sku.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'SKU is required',
                path: ['sku'],
            });
        }
        if (data.price !== '' && (Number.isNaN(Number(data.price)) || Number(data.price) < 0)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Price must be a non-negative number',
                path: ['price'],
            });
        }
        const stockNum = Number(data.stock);
        if (data.stock !== '' && (Number.isNaN(stockNum) || stockNum < 0 || !Number.isInteger(stockNum))) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Stock must be a non-negative integer',
                path: ['stock'],
            });
        }
    });

export const variantGenerationFormSchema = z.object({
    variants: z.record(variantFieldSchema),
});

export type VariantGenerationFormValues = z.infer<typeof variantGenerationFormSchema>;

/**
 * Maps a single generated combination and its filled-in form fields to a
 * CreateProductVariantInput. Shared by the full generation panel and the
 * missing-combinations dialog so both build identical mutation input.
 */
export function buildCreateVariantInput(
    fields: { sku: string; price: string; stock: string },
    combination: Pick<GeneratedVariant, 'optionIds' | 'optionNames'>,
    context: { productId: string; productName: string; languageCode: VariantTranslationLanguageCode },
): CreateProductVariantInput {
    const name = combination.optionNames.length
        ? `${context.productName} ${combination.optionNames.join(' ')}`
        : context.productName;
    return {
        productId: context.productId,
        sku: fields.sku,
        price: Number(fields.price),
        stockOnHand: Number(fields.stock),
        optionIds: combination.optionIds,
        translations: [{ languageCode: context.languageCode, name }],
    };
}

/**
 * The SKU / Price / Stock table cells for a single generated-variant row, shared by
 * the full generation panel and the missing-combinations dialog so both edit the
 * same react-hook-form fields with identical validation and formatting.
 */
export function VariantGenerationFieldCells({
    control,
    variantId,
    currency,
}: Readonly<{
    control: Control<VariantGenerationFormValues>;
    variantId: string;
    currency?: string;
}>) {
    const { t } = useLingui();
    return (
        <>
            <TableCell>
                <Controller
                    control={control}
                    name={`variants.${variantId}.sku`}
                    render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid || undefined}>
                            <Input {...field} placeholder={t`SKU`} data-testid="variant-sku-input" />
                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                    )}
                />
            </TableCell>

            <TableCell>
                <Controller
                    control={control}
                    name={`variants.${variantId}.price`}
                    render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid || undefined}>
                            <MoneyInput
                                {...field}
                                value={Number(field.value) || 0}
                                onChange={value => field.onChange(value.toString())}
                                currency={currency}
                            />
                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                    )}
                />
            </TableCell>

            <TableCell>
                <Controller
                    control={control}
                    name={`variants.${variantId}.stock`}
                    render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid || undefined}>
                            <Input
                                {...field}
                                type="number"
                                min="0"
                                step="1"
                                data-testid="variant-stock-input"
                            />
                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                    )}
                />
            </TableCell>
        </>
    );
}
