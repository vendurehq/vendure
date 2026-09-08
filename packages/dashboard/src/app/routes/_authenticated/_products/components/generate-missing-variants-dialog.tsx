import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { Save, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { createProductVariantsDocument } from '../products.graphql.js';
import { OptionGroup, partitionVariantCombinations } from '../utils/variant-combinations.js';
import {
    buildCreateVariantInput,
    VariantGenerationFieldCells,
    variantGenerationFormSchema,
    VariantGenerationFormValues,
} from './variant-generation-fields.js';

interface ExistingVariant {
    optionIds: string[];
}

/**
 * Adds any missing option combinations as new variants. Unlike {@link GenerateVariantsPanel},
 * which drives the zero-variants flow, this dialog is used on a product that already has
 * variants: after adding a new option value the user can fill in and create only the
 * combinations that don't exist yet, while the ones that do are shown for context.
 */
export function GenerateMissingVariantsDialog({
    productId,
    productName,
    optionGroups,
    existingVariants,
    onSuccess,
}: Readonly<{
    productId: string;
    productName: string;
    optionGroups: OptionGroup[];
    existingVariants: ExistingVariant[];
    onSuccess?: () => void;
}>) {
    const [open, setOpen] = useState(false);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button variant="outline" data-testid="generate-variants-btn" />}>
                <Sparkles className="mr-2 h-4 w-4" />
                <Trans>Generate variants</Trans>
            </DialogTrigger>
            {/* Override the dialog's default `sm:max-w-md` so the 5-column form table has room. */}
            <DialogContent className="sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Generate variants</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>
                            Create variants for the option combinations that don't exist yet. Combinations
                            that already exist are shown for context and can't be edited.
                        </Trans>
                    </DialogDescription>
                </DialogHeader>
                {/* Remount on open so the form's default values reflect the latest option groups. */}
                {open && (
                    <GenerateMissingVariantsForm
                        productId={productId}
                        productName={productName}
                        optionGroups={optionGroups}
                        existingVariants={existingVariants}
                        onSuccess={() => {
                            setOpen(false);
                            onSuccess?.();
                        }}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function GenerateMissingVariantsForm({
    productId,
    productName,
    optionGroups,
    existingVariants,
    onSuccess,
}: Readonly<{
    productId: string;
    productName: string;
    optionGroups: OptionGroup[];
    existingVariants: ExistingVariant[];
    onSuccess: () => void;
}>) {
    const { t } = useLingui();
    const { activeChannel } = useChannel();

    const { existing, missing } = useMemo(
        () =>
            partitionVariantCombinations(
                optionGroups,
                existingVariants.map(v => v.optionIds),
            ),
        [optionGroups, existingVariants],
    );

    const form = useForm<VariantGenerationFormValues>({
        resolver: zodResolver(variantGenerationFormSchema),
        defaultValues: {
            variants: Object.fromEntries(
                missing.map(v => [v.id, { enabled: true, sku: '', price: '', stock: '' }]),
            ),
        },
        mode: 'onChange',
    });

    const createVariantsMutation = useMutation({
        mutationFn: api.mutate(createProductVariantsDocument),
    });

    const handleCreate = form.handleSubmit(async formValues => {
        if (!activeChannel?.defaultLanguageCode) return;

        const variantsToCreate = missing
            .filter(v => formValues.variants[v.id]?.enabled)
            .map(v =>
                buildCreateVariantInput(formValues.variants[v.id], v, {
                    productId,
                    productName,
                    languageCode: activeChannel.defaultLanguageCode,
                }),
            );

        if (variantsToCreate.length === 0) return;

        try {
            await createVariantsMutation.mutateAsync({ input: variantsToCreate });
            toast.success(t`Successfully created variants`);
            onSuccess();
        } catch (error) {
            toast.error(t`Failed to create variants`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        }
    });

    const watchedVariants = useWatch({ control: form.control, name: 'variants' });
    const enabledCount = missing.filter(v => watchedVariants?.[v.id]?.enabled).length;

    if (missing.length === 0) {
        return (
            <div
                className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
                data-testid="all-variants-exist-message"
            >
                <Trans>All possible variant combinations already exist.</Trans>
            </div>
        );
    }

    return (
        <Form {...form}>
            <div className="space-y-4">
                {/* Cap the table height so a large grid (e.g. 3 groups × 5 options = 125 rows)
                    scrolls internally and the footer's Create button stays on screen. */}
                <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border">
                    <Table>
                        <TableHeader className="sticky top-0 z-10 bg-background">
                            <TableRow>
                                <TableHead className="w-12" />
                                <TableHead className="w-[28%]">
                                    <Trans>Variant</Trans>
                                </TableHead>
                                <TableHead>
                                    <Trans>SKU</Trans>
                                </TableHead>
                                <TableHead>
                                    <Trans>Price</Trans>
                                </TableHead>
                                <TableHead className="w-[130px]">
                                    <Trans>Stock on Hand</Trans>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {existing.map(variant => (
                                <TableRow
                                    key={variant.id}
                                    className="text-muted-foreground opacity-60"
                                    data-testid="existing-variant-row"
                                >
                                    {/* No checkbox: existing combinations are not selectable or editable. */}
                                    <TableCell />
                                    <TableCell className="font-medium">
                                        {variant.optionNames.join(' / ')}
                                    </TableCell>
                                    <TableCell colSpan={3}>
                                        <Badge variant="outline" data-testid="variant-exists-label">
                                            <Trans>Exists</Trans>
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {missing.map(variant => (
                                <TableRow key={variant.id} data-testid="missing-variant-row">
                                    <TableCell>
                                        <Controller
                                            control={form.control}
                                            name={`variants.${variant.id}.enabled`}
                                            render={({ field }) => (
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                />
                                            )}
                                        />
                                    </TableCell>
                                    <TableCell className="font-medium">
                                        {variant.optionNames.join(' / ')}
                                    </TableCell>
                                    <VariantGenerationFieldCells
                                        control={form.control}
                                        variantId={variant.id}
                                        currency={activeChannel?.defaultCurrencyCode}
                                    />
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        onClick={handleCreate}
                        disabled={createVariantsMutation.isPending || enabledCount === 0}
                        data-testid="create-missing-variants-btn"
                    >
                        <Save className="mr-2 h-4 w-4" />
                        {createVariantsMutation.isPending && <Trans>Creating...</Trans>}
                        {!createVariantsMutation.isPending && enabledCount === 1 && (
                            <Trans>Create variant</Trans>
                        )}
                        {!createVariantsMutation.isPending && enabledCount !== 1 && (
                            <Trans>Create {enabledCount} variants</Trans>
                        )}
                    </Button>
                </DialogFooter>
            </div>
        </Form>
    );
}
