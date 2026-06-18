import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
} from '@/vdb/components/ui/command.js';
import { Label } from '@/vdb/components/ui/label.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { api } from '@/vdb/graphql/api.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Settings2, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { createTagDocument, tagListDocument } from '../assets.graphql.js';
import { ManageTagsDialog } from './manage-tags-dialog.js';

interface AssetTagsEditorProps {
    selectedTags: string[];
    onTagsChange: (tags: string[]) => void;
    disabled?: boolean;
    onTagsUpdated?: () => void;
}

export function AssetTagsEditor({
    selectedTags,
    onTagsChange,
    disabled = false,
    onTagsUpdated,
}: Readonly<AssetTagsEditorProps>) {
    const [open, setOpen] = useState(false);
    const [searchValue, setSearchValue] = useState('');
    const [manageDialogOpen, setManageDialogOpen] = useState(false);
    const queryClient = useQueryClient();

    // Fetch available tags
    const { data: tagsData } = useQuery({
        queryKey: ['tags'],
        queryFn: () => api.query(tagListDocument, { options: { take: 100 } }),
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    // Create new tag mutation
    const createTagMutation = useMutation({
        mutationFn: (tagValue: string) => api.mutate(createTagDocument, { input: { value: tagValue } }),
        onSuccess: data => {
            const newTag = data.createTag.value;
            onTagsChange([...selectedTags, newTag]);
            toast.success(`Created tag "${newTag}"`);
            setSearchValue('');
            // Invalidate and refetch tags list
            queryClient.invalidateQueries({ queryKey: ['tags'] });
        },
        onError: error => {
            toast.error('Failed to create tag', {
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        },
    });

    const availableTags = tagsData?.tags.items || [];

    // Filter tags based on search value
    const filteredTags = availableTags.filter(tag =>
        tag.value.toLowerCase().includes(searchValue.toLowerCase()),
    );

    // Check if search value would create a new tag
    const isNewTag =
        searchValue.trim() &&
        !availableTags.some(tag => tag.value.toLowerCase() === searchValue.toLowerCase());

    const handleSelectTag = useCallback(
        (tagValue: string) => {
            if (!selectedTags.includes(tagValue)) {
                onTagsChange([...selectedTags, tagValue]);
            }
            setSearchValue('');
            setOpen(false);
        },
        [selectedTags, onTagsChange],
    );

    const handleRemoveTag = useCallback(
        (tagToRemove: string) => {
            onTagsChange(selectedTags.filter(tag => tag !== tagToRemove));
        },
        [selectedTags, onTagsChange],
    );

    const handleCreateTag = useCallback(() => {
        if (isNewTag) {
            createTagMutation.mutate(searchValue.trim());
        }
    }, [isNewTag, searchValue, createTagMutation]);

    return (
        <div className="space-y-3">
            <Label>
                <Trans>Tags</Trans>
            </Label>

            {/* Selected tags display */}
            <div className="flex flex-wrap gap-2 min-h-[32px]">
                {selectedTags.length === 0 ? (
                    <span className="text-sm text-muted-foreground">
                        <Trans>No tags selected</Trans>
                    </span>
                ) : (
                    selectedTags.map(tag => (
                        <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                            {tag}
                            {!disabled && (
                                <button
                                    type="button"
                                    onClick={() => handleRemoveTag(tag)}
                                    className="ml-1 hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            )}
                        </Badge>
                    ))
                )}
            </div>

            {/* Tag selector */}
            {!disabled && (
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger render={<Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={open}
                            className="w-full justify-between"
                        />}>
                        <Trans>Add tags...</Trans>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0" align="start">
                        <Command>
                            <CommandInput
                                placeholder="Search tags..."
                                value={searchValue}
                                onValueChange={setSearchValue}
                            />
                            <CommandEmpty>
                                {searchValue.trim() ? (
                                    <div className="">
                                        <Button
                                            variant="ghost"
                                            className="w-full justify-start"
                                            onClick={handleCreateTag}
                                            disabled={createTagMutation.isPending}
                                        >
                                            <Trans>Create "{searchValue.trim()}"</Trans>
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="p-2 text-sm">
                                        <Trans>No tags found</Trans>
                                    </div>
                                )}
                            </CommandEmpty>
                            <CommandGroup>
                                {/* Show option to create new tag if search doesn't match exactly */}
                                {isNewTag && (
                                    <CommandItem
                                        onSelect={handleCreateTag}
                                        disabled={createTagMutation.isPending}
                                        className="font-medium"
                                    >
                                        <Trans>Create "{searchValue.trim()}"</Trans>
                                    </CommandItem>
                                )}

                                {/* Show existing tags */}
                                {filteredTags.map(tag => {
                                    const isSelected = selectedTags.includes(tag.value);
                                    return (
                                        <CommandItem
                                            key={tag.id}
                                            onSelect={() => handleSelectTag(tag.value)}
                                            disabled={isSelected}
                                        >
                                            <Check
                                                className={cn(
                                                    'mr-2 h-4 w-4',
                                                    isSelected ? 'opacity-100' : 'opacity-0',
                                                )}
                                            />
                                            {tag.value}
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        </Command>
                    </PopoverContent>
                </Popover>
            )}

            {!disabled && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setManageDialogOpen(true)}
                    className="w-full justify-start"
                >
                    <Settings2 className="h-4 w-4 mr-2" />
                    <Trans>Manage tags</Trans>
                </Button>
            )}
            {/* Manage Tags Dialog */}
            <ManageTagsDialog
                open={manageDialogOpen}
                onOpenChange={setManageDialogOpen}
                onTagsUpdated={onTagsUpdated}
            />
        </div>
    );
}
