import { ConfirmationDialog } from '@/vdb/components/shared/confirmation-dialog.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/vdb/components/ui/alert-dialog.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { Page, PageBlock, PageLayout, PageTitle } from '@/vdb/framework/layout-engine/page-layout.js';
import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { z, zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { AddOptionGroupDialog } from './components/add-option-group-dialog.js';
import { AddProductVariantDialog } from './components/add-product-variant-dialog.js';
import {
    createProductOptionDocument,
    deleteProductVariantDocument,
    productDetailWithVariantsDocument,
    removeOptionGroupFromProductDocument,
    updateProductVariantDocument,
} from './products.graphql.js';

const pageId = 'manage-product-variants';
const getQueryKey = (id: string) => ['DetailPage', 'product', id, 'manage-variants'];

export const Route = createFileRoute('/_authenticated/_products/products_/$id_/variants')({
    component: ManageProductVariants,
    loader: async ({ context, params, location }) => {
        if (!params.id) {
            throw new Error('ID param is required');
        }
        const result = await context.queryClient.ensureQueryData({
            queryKey: getQueryKey(params.id),
            queryFn: () => api.query(productDetailWithVariantsDocument, { id: params.id }),
        });
        return {
            breadcrumb: [
                { path: '/products', label: <Trans>Products</Trans> },
                { path: `/products/${params.id}`, label: result.product?.name },
                <Trans>Manage Variants</Trans>,
            ],
        };
    },
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

const addOptionValueSchema = z.object({
    name: z.string().min(1, 'Option value name is required'),
});

type AddOptionValueFormValues = z.infer<typeof addOptionValueSchema>;
type Variant = NonNullable<ResultOf<typeof productDetailWithVariantsDocument>['product']>['variants'][0];

function AddOptionValueDialog({
    groupId,
    groupName,
    onSuccess,
}: Readonly<{
    groupId: string;
    groupName: string;
    onSuccess?: () => void;
}>) {
    const [open, setOpen] = useState(false);
    const { t } = useLingui();
    const { activeChannel } = useChannel();

    const form = useForm<AddOptionValueFormValues>({
        resolver: zodResolver(addOptionValueSchema),
        defaultValues: {
            name: '',
        },
    });

    const createOptionMutation = useMutation({
        mutationFn: api.mutate(createProductOptionDocument),
        onSuccess: () => {
            toast.success(t`Successfully added option value`);
            setOpen(false);
            form.reset();
            onSuccess?.();
        },
        onError: error => {
            toast.error(t`Failed to add option value`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        },
    });

    const onSubmit = (values: AddOptionValueFormValues) => {
        createOptionMutation.mutate({
            input: {
                productOptionGroupId: groupId,
                code: values.name.toLowerCase().replace(/\s+/g, '-'),
                translations: [
                    {
                        languageCode: activeChannel?.defaultLanguageCode ?? 'en',
                        name: values.name,
                    },
                ],
            },
        });
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button size="icon" variant="ghost" />}>
                <Plus className="h-3 w-3" />
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Add option value to {groupName}</Trans>
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        <Trans>Add a new option value to the {groupName} option group</Trans>
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormFieldWrapper
                            control={form.control}
                            name="name"
                            label={<Trans>Option value name</Trans>}
                            render={({ field }) => (
                                <Input {...field} placeholder={t`e.g., Red, Large, Cotton`} />
                            )}
                        />
                        <DialogFooter>
                            <Button type="submit" disabled={createOptionMutation.isPending}>
                                <Trans>Add option value</Trans>
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

function ManageProductVariants() {
    const { id } = Route.useParams();
    const { t } = useLingui();
    const [optionsToAddToVariant, setOptionsToAddToVariant] = useState<
        Record<string, Record<string, string>>
    >({});

    const { data: productData, refetch } = useQuery({
        queryFn: () => api.query(productDetailWithVariantsDocument, { id }),
        queryKey: getQueryKey(id),
    });

    const updateVariantMutation = useMutation({
        mutationFn: api.mutate(updateProductVariantDocument),
        onSuccess: () => {
            toast.success(t`Variant updated successfully`);
            refetch();
        },
    });

    const deleteVariantMutation = useMutation({
        mutationFn: api.mutate(deleteProductVariantDocument),
        onSuccess: () => {
            toast.success(t`Variant deleted successfully`);
            refetch();
        },
    });

    const [forceRemoveGroupId, setForceRemoveGroupId] = useState<string | null>(null);

    const removeOptionGroupMutation = useMutation({
        mutationFn: api.mutate(removeOptionGroupFromProductDocument),
        onSuccess: (result: any, variables: any) => {
            const removeResult = result?.removeOptionGroupFromProduct;
            if (removeResult && '__typename' in removeResult && removeResult.__typename === 'ProductOptionInUseError') {
                setForceRemoveGroupId(variables.optionGroupId);
                return;
            }
            toast.success(t`Option group removed`);
            refetch();
        },
    });

    const forceRemoveOptionGroupMutation = useMutation({
        mutationFn: api.mutate(removeOptionGroupFromProductDocument),
        onSuccess: () => {
            setForceRemoveGroupId(null);
            toast.success(t`Option group removed`);
            refetch();
        },
    });

    const setOptionToAddToVariant = (variantId: string, groupId: string, optionId: string | undefined) => {
        if (!optionId) {
            const updated = { ...optionsToAddToVariant };
            if (updated[variantId]) {
                delete updated[variantId][groupId];
            }
            setOptionsToAddToVariant(updated);
        } else {
            setOptionsToAddToVariant(prev => ({
                ...prev,
                [variantId]: {
                    ...prev[variantId],
                    [groupId]: optionId,
                },
            }));
        }
    };

    const addOptionToVariant = async (variant: Variant) => {
        const optionsToAdd = optionsToAddToVariant[variant.id];
        if (!optionsToAdd) return;

        const existingOptionIds = variant.options.map(o => o.id);
        const newOptionIds = Object.values(optionsToAdd).filter(Boolean);
        const allOptionIds = [...existingOptionIds, ...newOptionIds];

        await updateVariantMutation.mutateAsync({
            input: {
                id: variant.id,
                optionIds: allOptionIds,
            },
        });

        setOptionsToAddToVariant(prev => {
            const updated = { ...prev };
            delete updated[variant.id];
            return updated;
        });
    };

    const deleteVariant = async (variantId: string) => {
        await deleteVariantMutation.mutateAsync({ id: variantId });
    };

    const getOption = (variant: Variant, groupId: string) => {
        return variant.options.find(o => o.groupId === groupId);
    };

    if (!productData?.product) {
        return null;
    }

    return (
        <Page pageId={pageId}>
            <PageTitle>
                {productData.product.name} - <Trans>Manage variants</Trans>
            </PageTitle>
            <PageLayout>
                <PageBlock column="main" blockId="option-groups" title={<Trans>Option Groups</Trans>}>
                    <div className="space-y-4 mb-4">
                        {productData.product.optionGroups.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                <Trans>
                                    No option groups defined yet. Add option groups to create different
                                    variants of your product (e.g., Size, Color, Material)
                                </Trans>
                            </p>
                        ) : (
                            productData.product.optionGroups.map(group => (
                                <div key={group.id} className="grid grid-cols-12 gap-4 items-start">
                                    <div className="col-span-3">
                                        <label className="text-sm font-medium">
                                            <Trans>Option</Trans>
                                        </label>
                                        <Input value={group.name} disabled />
                                    </div>
                                    <div className="col-span-7">
                                        <label className="text-sm font-medium">
                                            <Trans>Option values</Trans>
                                        </label>
                                        <div className="flex flex-wrap gap-2 mt-1">
                                            {group.options.map(option => (
                                                <Badge key={option.id} variant="secondary">
                                                    {option.name}
                                                </Badge>
                                            ))}
                                            <AddOptionValueDialog
                                                groupId={group.id}
                                                groupName={group.name}
                                                onSuccess={() => refetch()}
                                            />
                                        </div>
                                    </div>
                                    <div className="col-span-1 flex items-end justify-end">
                                        <ConfirmationDialog
                                            title={t`Remove option group`}
                                            description={t`Are you sure you want to remove this option group from the product?`}
                                            onConfirm={() => removeOptionGroupMutation.mutate({
                                                productId: id,
                                                optionGroupId: group.id,
                                            })}
                                        >
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                disabled={removeOptionGroupMutation.isPending}
                                            >
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </ConfirmationDialog>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    <AddOptionGroupDialog
                        productId={id}
                        existingGroupIds={productData.product.optionGroups.map(g => g.id)}
                        onSuccess={() => refetch()}
                    />
                </PageBlock>

                <PageBlock column="main" blockId="product-variants" title={<Trans>Variants</Trans>}>
                    <div className="mb-4">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>
                                        <Trans>Name</Trans>
                                    </TableHead>
                                    <TableHead>
                                        <Trans>SKU</Trans>
                                    </TableHead>
                                    {productData.product.optionGroups.map(group => (
                                        <TableHead key={group.id}>{group.name}</TableHead>
                                    ))}
                                    <TableHead>
                                        <Trans>Delete</Trans>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {productData.product.variants.map(variant => (
                                    <TableRow key={variant.id}>
                                        <TableCell>{variant.name}</TableCell>
                                        <TableCell>{variant.sku}</TableCell>
                                        {productData.product?.optionGroups.map(group => {
                                            const option = getOption(variant, group.id);
                                            return (
                                                <TableCell key={group.id}>
                                                    {option ? (
                                                        <Badge variant="outline">{option.name}</Badge>
                                                    ) : group.options.length === 1 ? (
                                                        <div className="flex items-center gap-2">
                                                            <Badge variant="outline">
                                                                {group.options[0].name}
                                                            </Badge>
                                                            <Button
                                                                size="sm"
                                                                disabled={updateVariantMutation.isPending}
                                                                onClick={() =>
                                                                    updateVariantMutation.mutate({
                                                                        input: {
                                                                            id: variant.id,
                                                                            optionIds: [
                                                                                ...variant.options.map(
                                                                                    o => o.id,
                                                                                ),
                                                                                group.options[0].id,
                                                                            ],
                                                                        },
                                                                    })
                                                                }
                                                            >
                                                                <Save className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            <Select
                                                                items={Object.fromEntries(group.options.map(opt => [opt.id, opt.name]))}
                                                                value={
                                                                    optionsToAddToVariant[variant.id]?.[
                                                                        group.id
                                                                    ] || ''
                                                                }
                                                                onValueChange={value =>
                                                                    setOptionToAddToVariant(
                                                                        variant.id,
                                                                        group.id,
                                                                        value || undefined,
                                                                    )
                                                                }
                                                            >
                                                                <SelectTrigger className="w-32">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {group.options.map(opt => (
                                                                        <SelectItem
                                                                            key={opt.id}
                                                                            value={opt.id}
                                                                        >
                                                                            {opt.name}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                            <Button
                                                                size="sm"
                                                                variant={
                                                                    optionsToAddToVariant[variant.id]?.[
                                                                        group.id
                                                                    ]
                                                                        ? 'default'
                                                                        : 'outline'
                                                                }
                                                                disabled={
                                                                    !optionsToAddToVariant[variant.id]?.[
                                                                        group.id
                                                                    ]
                                                                }
                                                                onClick={() => addOptionToVariant(variant)}
                                                            >
                                                                <Save className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    )}
                                                </TableCell>
                                            );
                                        })}
                                        <TableCell>
                                            <ConfirmationDialog
                                                title={t`Delete variant`}
                                                description={t`Are you sure you want to delete this variant?`}
                                                onConfirm={() => deleteVariant(variant.id)}
                                            >
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    disabled={deleteVariantMutation.isPending}
                                                    data-testid="variant-delete-btn"
                                                >
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            </ConfirmationDialog>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    {productData.product.optionGroups.length > 0 && (
                        <AddProductVariantDialog
                            productId={id}
                            onSuccess={() => {
                                refetch();
                            }}
                        />
                    )}
                </PageBlock>
            </PageLayout>
            <AlertDialog open={!!forceRemoveGroupId} onOpenChange={(open) => { if (!open) setForceRemoveGroupId(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle><Trans>Force remove option group</Trans></AlertDialogTitle>
                        <AlertDialogDescription>
                            <Trans>This option group is in use by existing variants. Force removing it may affect those variants. Are you sure?</Trans>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setForceRemoveGroupId(null)}>
                            <Trans>Cancel</Trans>
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={() => {
                            if (forceRemoveGroupId) {
                                forceRemoveOptionGroupMutation.mutate({
                                    productId: id,
                                    optionGroupId: forceRemoveGroupId,
                                    force: true,
                                });
                            }
                        }}>
                            <Trans>Force remove</Trans>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Page>
    );
}
