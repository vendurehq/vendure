import { MoneyInput } from '@/vdb/components/data-input/money-input.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
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
import { Form } from '@/vdb/components/ui/form.js';
import { Input } from '@/vdb/components/ui/input.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql, ResultOf, VariablesOf } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { z, zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { createProductOptionDocument, createProductVariantsDocument } from '../products.graphql.js';
import { ProductOptionSelect } from './product-option-select.js';

const getProductOptionGroupsDocument = graphql(`
    query GetProductOptionGroups($productId: ID!) {
        product(id: $productId) {
            id
            name
            optionGroups {
                id
                code
                name
                options {
                    id
                    code
                    name
                }
            }
            variants {
                id
                name
                sku
                options {
                    id
                    code
                    name
                    groupId
                }
            }
        }
    }
`);

const formSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    sku: z.string().min(1, 'SKU is required'),
    price: z.string().min(1, 'Price is required'),
    stockOnHand: z.string().min(1, 'Stock level is required'),
    options: z.record(z.string(), z.string()),
});

type FormValues = z.infer<typeof formSchema>;

export function AddProductVariantDialog({
    productId,
    onSuccess,
}: {
    productId: string;
    onSuccess?: () => void;
}) {
    const [open, setOpen] = useState(false);
    const { activeChannel } = useChannel();
    const { t } = useLingui();
    const [duplicateVariantError, setDuplicateVariantError] = useState<string | null>(null);
    const [nameTouched, setNameTouched] = useState(false);

    const { data: productData, refetch } = useQuery({
        queryKey: ['productOptionGroups', productId],
        queryFn: () => api.query(getProductOptionGroupsDocument, { productId }),
    });

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: '',
            sku: '',
            price: '0',
            stockOnHand: '0',
            options: {},
        },
    });

    const checkForDuplicateVariant = useCallback(
        (values: FormValues) => {
            if (!productData?.product) return;

            const newOptionIds = Object.values(values.options).sort();
            if (newOptionIds.length !== productData.product.optionGroups.length) {
                setDuplicateVariantError(null);
                return;
            }

            const existingVariant = productData.product.variants.find(variant => {
                const variantOptionIds = variant.options.map(opt => opt.id).sort();
                return JSON.stringify(variantOptionIds) === JSON.stringify(newOptionIds);
            });

            if (existingVariant) {
                setDuplicateVariantError(
                    `A variant with these options already exists: ${existingVariant.name} (${existingVariant.sku})`,
                );
            } else {
                setDuplicateVariantError(null);
            }
        },
        [productData?.product],
    );

    const generateNameFromOptions = useCallback(
        (values: FormValues) => {
            if (!productData?.product?.name || nameTouched) return;

            const selectedOptions = Object.entries(values.options)
                .map(([groupId, optionId]) => {
                    const group = productData.product?.optionGroups.find(g => g.id === groupId);
                    const option = group?.options.find(o => o.id === optionId);
                    return option?.name;
                })
                .filter(Boolean);

            if (selectedOptions.length === productData.product.optionGroups.length) {
                const newName = `${productData.product.name} ${selectedOptions.join(' ')}`;
                form.setValue('name', newName, { shouldDirty: true });
            }
        },
        [productData?.product, nameTouched, form],
    );

    // Watch for changes in options to check for duplicates and update name
    const options = form.watch('options');
    useEffect(() => {
        checkForDuplicateVariant(form.getValues());
        generateNameFromOptions(form.getValues());
    }, [JSON.stringify(options), checkForDuplicateVariant, generateNameFromOptions, form]);

    // Also check when the dialog opens and product data is loaded
    useEffect(() => {
        if (open && productData?.product) {
            checkForDuplicateVariant(form.getValues());
        }
    }, [open, productData?.product, checkForDuplicateVariant, form]);

    const createProductVariantMutation = useMutation({
        mutationFn: api.mutate(createProductVariantsDocument),
        onSuccess: () => {
            toast.success(t`Successfully created product variant`);
            setOpen(false);
            onSuccess?.();
        },
        onError: error => {
            toast.error(t`Failed to create product variant`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        },
    });

    const createProductOptionMutation = useMutation({
        mutationFn: api.mutate(createProductOptionDocument),
        onSuccess: (
            result: ResultOf<typeof createProductOptionDocument>,
            variables: VariablesOf<typeof createProductOptionDocument>,
        ) => {
            if (result?.createProductOption) {
                // Update the form with the new option
                const currentOptions = form.getValues('options');
                form.setValue('options', {
                    ...currentOptions,
                    [variables.input.productOptionGroupId]: result.createProductOption.id,
                });
                // Refetch product data to get the new option
                refetch();
            }
        },
    });

    const onSubmit = useCallback(
        (values: FormValues) => {
            if (!productData?.product) return;
            if (duplicateVariantError) return;

            createProductVariantMutation.mutate({
                input: [
                    {
                        productId,
                        sku: values.sku,
                        price: Number(values.price),
                        stockOnHand: Number(values.stockOnHand),
                        optionIds: Object.values(values.options),
                        translations: [
                            {
                                languageCode: activeChannel?.defaultLanguageCode ?? 'en',
                                name: values.name,
                            },
                        ],
                    },
                ],
            });
        },
        [createProductVariantMutation, productData?.product, duplicateVariantError, productId],
    );

    // Don't show the "Add variant" button if there are no option groups
    if (!productData?.product?.optionGroups.length) {
        return null;
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button variant="outline" />}>
                <Plus className="mr-2 h-4 w-4" />
                <Trans>Add variant</Trans>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Add product variant</Trans>
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        <Trans>Create a new product variant with options, pricing, and stock</Trans>
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form
                        onSubmit={e => {
                            e.stopPropagation();
                            form.handleSubmit(onSubmit)(e);
                        }}
                        className="space-y-4"
                    >
                        {productData?.product?.optionGroups.length && (
                            <div className="flex flex-col gap-2">
                                <div className="flex justify-between items-center">
                                    <label className="text-sm font-medium">
                                        <Trans>Product options</Trans>
                                    </label>
                                </div>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            {productData?.product?.optionGroups.map(group => (
                                <ProductOptionSelect
                                    key={group.id}
                                    group={group}
                                    value={form.watch(`options.${group.id}`)}
                                    onChange={value => {
                                        form.setValue(`options.${group.id}`, value, {
                                            shouldDirty: true,
                                            shouldValidate: true,
                                        });
                                    }}
                                    onCreateOption={name => {
                                        createProductOptionMutation.mutate({
                                            input: {
                                                productOptionGroupId: group.id,
                                                code: name.toLowerCase().replace(/\s+/g, '-'),
                                                translations: [
                                                    {
                                                        languageCode:
                                                            activeChannel?.defaultLanguageCode ?? 'en',
                                                        name,
                                                    },
                                                ],
                                            },
                                        });
                                    }}
                                />
                            ))}
                        </div>
                        <FormFieldWrapper
                            control={form.control}
                            name="name"
                            label={<Trans>Name</Trans>}
                            render={({ field }) => <Input {...field} onFocus={() => setNameTouched(true)} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="sku"
                            label={<Trans>SKU</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="price"
                            label={<Trans>Price</Trans>}
                            render={({ field }) => (
                                <MoneyInput
                                    {...field}
                                    value={Number(field.value) || 0}
                                    onChange={value => field.onChange(value.toString())}
                                    currency={activeChannel?.defaultCurrencyCode}
                                />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="stockOnHand"
                            label={<Trans>Stock level</Trans>}
                            render={({ field }) => <Input type="number" {...field} />}
                        />
                        <DialogFooter className="flex flex-col items-end gap-2">
                            {duplicateVariantError && (
                                <p className="text-sm text-destructive">{duplicateVariantError}</p>
                            )}
                            <Button
                                type="submit"
                                disabled={createProductVariantMutation.isPending || !!duplicateVariantError}
                            >
                                <Trans>Create variant</Trans>
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
