import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/vdb/components/ui/command.js';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/vdb/components/ui/tabs.js';
import { api } from '@/vdb/graphql/api.js';
import { zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { Check, Link, Plus, Save } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { optionGroupListDocument } from '../../_option-groups/option-groups.graphql.js';
import { addOptionGroupToProductDocument, createProductOptionGroupDocument } from '../products.graphql.js';
import { OptionGroup, optionGroupSchema, SingleOptionGroupEditor } from './option-groups-editor.js';

export function AddOptionGroupDialog({
    productId,
    existingGroupIds,
    onSuccess,
    trigger,
}: Readonly<{
    productId: string;
    existingGroupIds?: string[];
    onSuccess?: () => void;
    trigger?: React.ReactElement;
}>) {
    const [open, setOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<string>('existing');
    const { t } = useLingui();

    const form = useForm<OptionGroup>({
        resolver: zodResolver(optionGroupSchema),
        defaultValues: {
            name: '',
            values: [],
        },
        mode: 'onChange',
    });

    const createOptionGroupMutation = useMutation({
        mutationFn: api.mutate(createProductOptionGroupDocument),
    });

    const addOptionGroupToProductMutation = useMutation({
        mutationFn: api.mutate(addOptionGroupToProductDocument),
    });

    const handleAssignExisting = async (optionGroupId: string) => {
        if (addOptionGroupToProductMutation.isPending) return;
        try {
            await addOptionGroupToProductMutation.mutateAsync({
                productId,
                optionGroupId,
            });
            toast.success(t`Successfully assigned option group`);
            setOpen(false);
            onSuccess?.();
        } catch (error) {
            toast.error(t`Failed to assign option group`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        }
    };

    const handleCreateNew = form.handleSubmit(async formValue => {
        try {
            // TODO: use the active language code from the UI language context
            // instead of hardcoding 'en'
            const createResult = await createOptionGroupMutation.mutateAsync({
                input: {
                    code: formValue.name.toLowerCase().replace(/\s+/g, '-'),
                    translations: [
                        {
                            languageCode: 'en',
                            name: formValue.name,
                        },
                    ],
                    options: formValue.values.map(value => ({
                        code: value.value.toLowerCase().replace(/\s+/g, '-'),
                        translations: [
                            {
                                languageCode: 'en',
                                name: value.value,
                            },
                        ],
                    })),
                },
            });

            if (createResult?.createProductOptionGroup) {
                await addOptionGroupToProductMutation.mutateAsync({
                    productId,
                    optionGroupId: createResult.createProductOptionGroup.id,
                });
            }

            toast.success(t`Successfully created option group`);
            setOpen(false);
            onSuccess?.();
        } catch (error) {
            toast.error(t`Failed to create option group`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        }
    });

    return (
        <Dialog
            open={open}
            onOpenChange={isOpen => {
                setOpen(isOpen);
                if (!isOpen) {
                    form.reset();
                    setActiveTab('existing');
                }
            }}
        >
            {trigger ? (
                <DialogTrigger render={trigger} />
            ) : (
                <DialogTrigger render={<Button variant="outline" size="sm" type="button" className="w-full gap-2" />}>
                    <Plus className="h-4 w-4" />
                    <Trans>Add option group</Trans>
                </DialogTrigger>
            )}
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Add option group to product</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>Assign an existing option group or create a new one</Trans>
                    </DialogDescription>
                </DialogHeader>
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="existing">
                            <Link className="mr-2 h-4 w-4" />
                            <Trans>Assign existing</Trans>
                        </TabsTrigger>
                        <TabsTrigger value="new">
                            <Plus className="mr-2 h-4 w-4" />
                            <Trans>Create new</Trans>
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="existing">
                        <OptionGroupSearch
                            existingGroupIds={existingGroupIds}
                            onSelect={handleAssignExisting}
                            isPending={addOptionGroupToProductMutation.isPending}
                        />
                    </TabsContent>
                    <TabsContent value="new">
                        <div className="space-y-4">
                            <Form {...form}>
                                <SingleOptionGroupEditor
                                    control={form.control}
                                    fieldArrayPath={''}
                                />
                            </Form>
                        </div>
                        <DialogFooter className="mt-4">
                            <Button
                                onClick={handleCreateNew}
                                disabled={
                                    !form.formState.isValid ||
                                    createOptionGroupMutation.isPending ||
                                    addOptionGroupToProductMutation.isPending
                                }
                            >
                                <Save className="mr-2 h-4 w-4" />
                                <Trans>Save option group</Trans>
                            </Button>
                        </DialogFooter>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

function OptionGroupSearch({
    existingGroupIds = [],
    onSelect,
    isPending,
}: Readonly<{
    existingGroupIds?: string[];
    onSelect: (optionGroupId: string) => void;
    isPending: boolean;
}>) {
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const { t } = useLingui();

    const { data, isLoading } = useQuery({
        queryKey: ['option-groups-search', debouncedSearchTerm],
        queryFn: () =>
            api.query(optionGroupListDocument, {
                options: {
                    take: 20,
                    sort: { name: 'ASC' },
                    filter: debouncedSearchTerm
                        ? { name: { contains: debouncedSearchTerm } }
                        : undefined,
                },
            }),
        staleTime: 1000 * 60,
    });

    const items = data?.productOptionGroups?.items ?? [];
    const sortedItems = [...items].sort((a, b) => {
        const aAssigned = existingGroupIds.includes(a.id);
        const bAssigned = existingGroupIds.includes(b.id);
        if (aAssigned !== bAssigned) return aAssigned ? -1 : 1;
        return 0;
    });

    return (
        <Command shouldFilter={false} className="border rounded-md">
            <CommandInput
                placeholder={t`Search option groups...`}
                onValueChange={setSearchTerm}
                className="h-10"
            />
            <CommandList className="max-h-[300px]">
                <CommandEmpty>
                    {isLoading ? <Trans>Loading...</Trans> : <Trans>No option groups found</Trans>}
                </CommandEmpty>
                {sortedItems.map(group => {
                    const isAlreadyAssigned = existingGroupIds.includes(group.id);
                    return (
                        <CommandItem
                            key={group.id}
                            disabled={isAlreadyAssigned || isPending}
                            onSelect={() => {
                                if (!isAlreadyAssigned) {
                                    onSelect(group.id);
                                }
                            }}
                            className="flex items-center justify-between"
                        >
                            <div>
                                <div className="font-medium">{group.name}</div>
                                <div className="text-sm text-muted-foreground">{group.code}</div>
                            </div>
                            {isAlreadyAssigned && (
                                <Badge variant="secondary" className="ml-2">
                                    <Check className="mr-1 h-3 w-3" />
                                    <Trans>Assigned</Trans>
                                </Badge>
                            )}
                        </CommandItem>
                    );
                })}
            </CommandList>
        </Command>
    );
}
