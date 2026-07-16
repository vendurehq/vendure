import { ConfirmationDialog } from '@/vdb/components/shared/confirmation-dialog.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
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
import { useRedirectToListOnNotFound } from '@/vdb/hooks/use-redirect-to-list-on-not-found.js';
import { z, zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { AddOptionGroupDialog } from './components/add-option-group-dialog.js';
import { AddProductVariantDialog } from './components/add-product-variant-dialog.js';
import { ForceRemoveOptionGroupDialog } from './components/force-remove-option-group-dialog.js';
import { useRemoveOptionGroup } from './hooks/use-remove-option-group.js';
import {
    createProductOptionDocument,
    deleteProductVariantDocument,
    productDetailWithVariantsDocument,
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
    errorComponent: ({ error }) => <ErrorPage error={error} />,
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

// Per-cell auto-save feedback for the option-assignment selects. `value` holds
// the optimistically-selected option id (so the select shows the pending choice
// before the server confirms) and `status` drives the inline spinner/checkmark.
type OptionCellState = { value: string; status: 'saving' | 'success' };

const getCellKey = (variantId: string, groupId: string) => `${variantId}:${groupId}`;

function ManageProductVariants() {
    const { id } = Route.useParams();
    const { t } = useLingui();
    const [optionCellState, setOptionCellState] = useState<Record<string, OptionCellState>>({});

    const { data: productData, refetch, isFetching } = useQuery({
        queryFn: () => api.query(productDetailWithVariantsDocument, { id }),
        queryKey: getQueryKey(id),
    });

    // This page fetches its own data rather than using `useDetailPage`, so it
    // opts into the not-found redirect explicitly (e.g. after a channel switch).
    useRedirectToListOnNotFound(productData?.product, { isFetching });

    const updateVariantMutation = useMutation({
        mutationFn: api.mutate(updateProductVariantDocument),
    });

    const deleteVariantMutation = useMutation({
        mutationFn: api.mutate(deleteProductVariantDocument),
        onSuccess: () => {
            toast.success(t`Variant deleted successfully`);
            refetch();
        },
    });

    const {
        remove: removeOptionGroup,
        forceRemove: forceRemoveOptionGroup,
        inUseGroupId: forceRemoveGroupId,
        clearInUseGroup,
        isPending: isRemovingOptionGroup,
    } = useRemoveOptionGroup(id, { onRemoved: refetch });

    // Auto-save an option-value assignment for a single cell. Fires the update
    // immediately. On error the optimistic value is dropped so the select reverts
    // to the server value and the server message is surfaced.
    const assignOptionToVariant = async (variant: Variant, groupId: string, optionId: string) => {
        const cellKey = getCellKey(variant.id, groupId);
        setOptionCellState(prev => ({ ...prev, [cellKey]: { value: optionId, status: 'saving' } }));

        // Build the full option-id set from every group's effective value: a pending
        // cell value (a save in flight or just completed for that group) takes
        // precedence over the server value, then the group being changed wins. This
        // prevents a concurrent save in another group from being reverted by this
        // one's click-time snapshot of `variant.options`.
        const optionIdsByGroup = new Map<string, string>();
        for (const option of variant.options) {
            optionIdsByGroup.set(option.groupId, option.id);
        }
        for (const group of productData?.product?.optionGroups ?? []) {
            const pending = optionCellState[getCellKey(variant.id, group.id)];
            if (pending) {
                optionIdsByGroup.set(group.id, pending.value);
            }
        }
        optionIdsByGroup.set(groupId, optionId);
        const optionIds = [...optionIdsByGroup.values()];

        try {
            await updateVariantMutation.mutateAsync({ input: { id: variant.id, optionIds } });
        } catch (error) {
            setOptionCellState(prev => {
                const updated = { ...prev };
                delete updated[cellKey];
                return updated;
            });
            toast.error(t`Failed to update variant`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
            return;
        }

        setOptionCellState(prev => ({ ...prev, [cellKey]: { value: optionId, status: 'success' } }));
        // Refetch is intentionally outside the try/catch: a failed background refetch
        // must not surface the save-failed toast or revert the just-saved value.
        refetch();
        setTimeout(() => {
            setOptionCellState(prev => {
                const current = prev[cellKey];
                // Only clear if this exact success is still showing; a newer change to
                // the same cell owns the state and must not be wiped by this timeout.
                if (current?.status === 'success' && current.value === optionId) {
                    const updated = { ...prev };
                    delete updated[cellKey];
                    return updated;
                }
                return prev;
            });
        }, 1500);
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
                                        <div className="text-sm font-medium text-muted-foreground">
                                            <Trans>Option</Trans>
                                        </div>
                                        <div className="text-sm mt-1">{group.name}</div>
                                    </div>
                                    <div className="col-span-7">
                                        <label className="text-sm font-medium">
                                            <Trans>Option values</Trans>
                                        </label>
                                        <div className="flex flex-wrap gap-2 mt-1">
                                            {group.options.map(option => (
                                                <Badge key={option.id} variant="default">
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
                                        <PermissionGuard requires={['UpdateProduct', 'UpdateCatalog']}>
                                            <ConfirmationDialog
                                                title={t`Remove option group`}
                                                description={t`Are you sure you want to remove this option group from the product?`}
                                                destructive
                                                onConfirm={() => removeOptionGroup(group.id)}
                                            >
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    disabled={isRemovingOptionGroup}
                                                >
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            </ConfirmationDialog>
                                        </PermissionGuard>
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
                                        <span className="sr-only">
                                            <Trans>Actions</Trans>
                                        </span>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {productData.product.variants.map(variant => (
                                    <TableRow key={variant.id}>
                                        <TableCell>{variant.name}</TableCell>
                                        <TableCell>{variant.sku}</TableCell>
                                        {productData.product?.optionGroups.map(group => {
                                            const cellKey = getCellKey(variant.id, group.id);
                                            const cell = optionCellState[cellKey];
                                            const value = cell?.value ?? getOption(variant, group.id)?.id ?? '';
                                            return (
                                                <TableCell key={group.id}>
                                                    <div className="flex items-center gap-2">
                                                        <Select
                                                            items={Object.fromEntries(
                                                                group.options.map(opt => [opt.id, opt.name]),
                                                            )}
                                                            value={value}
                                                            onValueChange={optionId => {
                                                                if (optionId) {
                                                                    assignOptionToVariant(
                                                                        variant,
                                                                        group.id,
                                                                        optionId,
                                                                    );
                                                                }
                                                            }}
                                                        >
                                                            <SelectTrigger
                                                                className="w-32"
                                                                data-testid={`variant-option-select-${variant.id}-${group.id}`}
                                                            >
                                                                <SelectValue placeholder={t`Select`} />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {group.options.map(opt => (
                                                                    <SelectItem key={opt.id} value={opt.id}>
                                                                        {opt.name}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        {cell?.status === 'saving' && (
                                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                        )}
                                                        {cell?.status === 'success' && (
                                                            <Check className="h-4 w-4 text-success" />
                                                        )}
                                                    </div>
                                                </TableCell>
                                            );
                                        })}
                                        <TableCell>
                                            <ConfirmationDialog
                                                title={t`Delete variant`}
                                                description={t`Are you sure you want to delete this variant?`}
                                                destructive
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
            <ForceRemoveOptionGroupDialog
                open={!!forceRemoveGroupId}
                onOpenChange={open => {
                    if (!open) {
                        clearInUseGroup();
                    }
                }}
                onConfirm={forceRemoveOptionGroup}
                isPending={isRemovingOptionGroup}
            />
        </Page>
    );
}
