import { ConfirmationDialog } from '@/vdb/components/shared/confirmation-dialog.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { Save, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { createProductVariantsDocument } from '../products.graphql.js';
import { generateVariantCombinations, OptionGroup } from '../utils/variant-combinations.js';
import {
    buildCreateVariantInput,
    VariantGenerationFieldCells,
    variantGenerationFormSchema,
    VariantGenerationFormValues,
} from './variant-generation-fields.js';

export function GenerateVariantsPanel({
    productId,
    productName,
    optionGroups,
    onSuccess,
    onBack,
}: Readonly<{
    productId: string;
    productName: string;
    optionGroups: OptionGroup[];
    onSuccess?: () => void;
    onBack?: {
        handler: () => void;
        confirmation?: { title: string; description: string };
    };
}>) {
    const { t } = useLingui();
    const { activeChannel } = useChannel();

    const variants = useMemo(() => generateVariantCombinations(optionGroups), [optionGroups]);

    // For small products (few option-group combinations) the historical
    // "all variants enabled by default" workflow is convenient. For products
    // built on a shared option group with many values (the reporter's case in
    // OSS-531 — 129 colors), defaulting every variant on forces the user to
    // uncheck almost everything. Above the threshold we flip the default off
    // and let them check only the ones they want; the filter + master toggle
    // above the table make that workflow practical.
    const enableByDefault = variants.length <= 20;

    const form = useForm<VariantGenerationFormValues>({
        resolver: zodResolver(variantGenerationFormSchema),
        defaultValues: {
            variants: Object.fromEntries(
                variants.map(v => [v.id, { enabled: enableByDefault, sku: '', price: '', stock: '' }]),
            ),
        },
        mode: 'onChange',
    });

    const createVariantsMutation = useMutation({
        mutationFn: api.mutate(createProductVariantsDocument),
    });

    const handleCreateVariants = form.handleSubmit(async formValues => {
        if (!activeChannel?.defaultLanguageCode) return;

        const variantsToCreate = variants
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
            onSuccess?.();
        } catch (error) {
            toast.error(t`Failed to create variants`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        }
    });

    const watchedVariants = useWatch({ control: form.control, name: 'variants' });
    const enabledCount = variants.filter(v => watchedVariants?.[v.id]?.enabled).length;

    const [filter, setFilter] = useState('');
    const debouncedFilter = useDebounce(filter, 300);
    const filteredVariants = useMemo(() => {
        if (!debouncedFilter) return variants;
        // Rows render `optionNames.join(' / ')`, so accept that exact shape
        // ("Red / M") as well as the space-joined source name.
        const normalize = (s: string) =>
            s
                .toLowerCase()
                .replace(/\s*\/\s*/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        const q = normalize(debouncedFilter);
        if (!q) return variants;
        return variants.filter(v => normalize(v.name).includes(q));
    }, [variants, debouncedFilter]);

    // Master toggle drives every variant currently visible after the filter,
    // not the whole list — so a user can scope a check/uncheck-all to e.g.
    // "Red" without losing their selections in other rows.
    const visibleEnabledCount = filteredVariants.filter(v => watchedVariants?.[v.id]?.enabled).length;
    const allVisibleEnabled = filteredVariants.length > 0 && visibleEnabledCount === filteredVariants.length;
    const someVisibleEnabled = visibleEnabledCount > 0;
    const handleToggleVisible = () => {
        const shouldEnable = !allVisibleEnabled;
        // Single setValue with the full record avoids N RHF subscriber updates
        // (the table has 129+ rows for shared option groups).
        const next = { ...(form.getValues('variants') ?? {}) };
        for (const v of filteredVariants) {
            next[v.id] = { ...next[v.id], enabled: shouldEnable };
        }
        form.setValue('variants', next, { shouldDirty: true });
    };

    const showVariantTools = variants.length > 1;
    const isFiltered = debouncedFilter.length > 0;

    return (
        <Form {...form}>
            <div className="space-y-4">
                {showVariantTools && (
                    <div className="flex items-center gap-3">
                        <div className="relative w-full max-w-sm">
                            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={filter}
                                onChange={e => setFilter(e.target.value)}
                                placeholder={t`Filter variants...`}
                                className="pl-8"
                                data-testid="variant-filter-input"
                            />
                        </div>
                        <div className="text-sm text-muted-foreground">
                            {(() => {
                                // Hoist locals so Lingui extracts named placeholders
                                // (`{shown}`, `{total}`, `{selected}`) in the .po
                                // catalog instead of positional `{0}`, `{1}`, `{2}`.
                                const shown = filteredVariants.length;
                                const total = variants.length;
                                const selected = enabledCount;
                                return isFiltered ? (
                                    <Trans>
                                        Showing {shown} of {total} • {selected} selected
                                    </Trans>
                                ) : (
                                    <Trans>
                                        {selected} of {total} selected
                                    </Trans>
                                );
                            })()}
                        </div>
                    </div>
                )}
                <Table>
                    <TableHeader>
                        <TableRow>
                            {showVariantTools && (
                                <TableHead className="w-12">
                                    <Checkbox
                                        checked={allVisibleEnabled || someVisibleEnabled}
                                        indeterminate={someVisibleEnabled && !allVisibleEnabled}
                                        onCheckedChange={handleToggleVisible}
                                        disabled={filteredVariants.length === 0}
                                        aria-label={t`Toggle all visible variants`}
                                        data-testid="variant-toggle-all"
                                    />
                                </TableHead>
                            )}
                            {showVariantTools && (
                                <TableHead>
                                    <Trans>Variant</Trans>
                                </TableHead>
                            )}
                            <TableHead>
                                <Trans>SKU</Trans>
                            </TableHead>
                            <TableHead>
                                <Trans>Price</Trans>
                            </TableHead>
                            <TableHead>
                                <Trans>Stock on Hand</Trans>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredVariants.length === 0 && (
                            <TableRow>
                                <TableCell
                                    colSpan={showVariantTools ? 5 : 3}
                                    className="text-center text-muted-foreground py-8"
                                >
                                    <Trans>No variants match the current filter.</Trans>
                                </TableCell>
                            </TableRow>
                        )}
                        {filteredVariants.map(variant => (
                            <TableRow key={variant.id}>
                                {showVariantTools && (
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
                                )}

                                {showVariantTools && (
                                    <TableCell className="font-medium">
                                        {variant.optionNames.join(' / ')}
                                    </TableCell>
                                )}

                                <VariantGenerationFieldCells
                                    control={form.control}
                                    variantId={variant.id}
                                    currency={activeChannel?.defaultCurrencyCode}
                                />
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>

                <div className="flex justify-between items-center">
                    <div>
                        {onBack &&
                            (onBack.confirmation ? (
                                <ConfirmationDialog
                                    title={onBack.confirmation.title}
                                    description={onBack.confirmation.description}
                                    onConfirm={onBack.handler}
                                >
                                    <button
                                        type="button"
                                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        ← <Trans>Back</Trans>
                                    </button>
                                </ConfirmationDialog>
                            ) : (
                                <button
                                    type="button"
                                    onClick={onBack.handler}
                                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    ← <Trans>Back</Trans>
                                </button>
                            ))}
                    </div>
                    <Button
                        type="button"
                        onClick={handleCreateVariants}
                        disabled={createVariantsMutation.isPending || enabledCount === 0}
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
                </div>
            </div>
        </Form>
    );
}
