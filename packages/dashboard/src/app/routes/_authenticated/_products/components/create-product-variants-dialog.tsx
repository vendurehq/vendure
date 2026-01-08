import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans } from '@lingui/react/macro';
import { normalizeString } from '@/vdb/lib/utils.js';
import { useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import {
    addOptionGroupToProductDocument,
    createProductOptionGroupDocument,
    createProductVariantsDocument,
} from '../products.graphql.js';
import { CreateProductVariants, VariantConfiguration } from './create-product-variants.js';
import { toast } from 'sonner';

export function CreateProductVariantsDialog({
    productId,
    productName,
    onSuccess,
}: {
    productId: string;
    productName: string;
    onSuccess?: () => void;
}) {
    const { activeChannel } = useChannel();
    const [variantData, setVariantData] = useState<VariantConfiguration | null>(null);
    const [open, setOpen] = useState(false);

    const createOptionGroupMutation = useMutation({
        mutationFn: api.mutate(createProductOptionGroupDocument),
    });

    const addOptionGroupToProductMutation = useMutation({
        mutationFn: api.mutate(addOptionGroupToProductDocument),
    });

    const createProductVariantsMutation = useMutation({
        mutationFn: api.mutate(createProductVariantsDocument),
    });

    async function handleCreateVariants() {
        if (!variantData || !activeChannel?.defaultLanguageCode) return;

        try {
            // 1. Create option groups and their options
            const createdOptionGroups = await Promise.all(
                variantData.optionGroups.map(async optionGroup => {
                    const result = await createOptionGroupMutation.mutateAsync({
                        input: {
                            code: normalizeString(optionGroup.name, '-'),
                            translations: [
                                {
                                    languageCode: activeChannel.defaultLanguageCode,
                                    name: optionGroup.name,
                                },
                            ],
                            options: optionGroup.values.map(value => ({
                                code: normalizeString(value.value, '-'),
                                translations: [
                                    {
                                        languageCode: activeChannel.defaultLanguageCode,
                                        name: value.value,
                                    },
                                ],
                            })),
                        },
                    });
                    return result.createProductOptionGroup;
                }),
            );

            // 2. Add option groups to product
            await Promise.all(
                createdOptionGroups.map(group =>
                    addOptionGroupToProductMutation.mutateAsync({
                        productId,
                        optionGroupId: group.id,
                    }),
                ),
            );

            // 3. Create variants
            const variantsToCreate = variantData.variants
                .filter(variant => variant.enabled)
                .map(variant => {
                    const name = variant.options.length
                        ? `${productName} ${variant.options.map(option => option.value).join(' ')}`
                        : productName;

                    return {
                        productId,
                        sku: variant.sku,
                        price: Number(variant.price),
                        stockOnHand: Number(variant.stock),
                        optionIds: variant.options.map(option => {
                            const optionGroup = createdOptionGroups.find(g => g.name === option.name);
                            if (!optionGroup) {
                                throw new Error(`Could not find option group ${option.name}`);
                            }
                            const createdOption = optionGroup.options.find(o => o.name === option.value);
                            if (!createdOption) {
                                throw new Error(
                                    `Could not find option ${option.value} in group ${option.name}`,
                                );
                            }
                            return createdOption.id;
                        }),
                        translations: [
                            {
                                languageCode: activeChannel.defaultLanguageCode,
                                name: name,
                            },
                        ],
                    };
                });

            await createProductVariantsMutation.mutateAsync({ input: variantsToCreate });
            setOpen(false);
            onSuccess?.();
        } catch (error) {
            console.error('Error creating variants:', error);

            const fieldErrors = (error as any)?.fieldErrors;
            const errorMessage =
                fieldErrors?.[0]?.message ??
                'An unexpected error occurred while creating variants.';

            toast.error(errorMessage);
        }
    }

    const handleOnChange = useCallback(
        ({ data }: { data: VariantConfiguration }) => setVariantData(data),
        [],
    );
    const createCount = Object.values(variantData?.variants ?? {}).filter(v => v.enabled).length;

    return (
        <>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                    <Button type="button">
                        <Plus className="mr-2 h-4 w-4" /> Create Variants
                    </Button>
                </DialogTrigger>

                <DialogContent className="max-w-90vw">
                    <DialogHeader>
                        <DialogTitle>
                            <Trans>Create Variants</Trans>
                        </DialogTitle>
                        <DialogDescription>
                            <Trans>Create variants for your product</Trans>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="mt-4">
                        <CreateProductVariants
                            onChange={handleOnChange}
                            currencyCode={activeChannel?.defaultCurrencyCode}
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            onClick={handleCreateVariants}
                            disabled={
                                !variantData ||
                                createOptionGroupMutation.isPending ||
                                addOptionGroupToProductMutation.isPending ||
                                createProductVariantsMutation.isPending ||
                                createCount === 0
                            }
                        >
                            {createOptionGroupMutation.isPending ||
                                addOptionGroupToProductMutation.isPending ||
                                createProductVariantsMutation.isPending ? (
                                <Trans>Creating...</Trans>
                            ) : (
                                <Trans>Create {createCount} variants</Trans>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
