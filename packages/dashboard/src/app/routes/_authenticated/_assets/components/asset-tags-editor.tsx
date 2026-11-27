import { Button } from '@/vdb/components/ui/button.js';
import {
    Combobox,
    ComboboxChip,
    ComboboxChips,
    ComboboxChipsInput,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxItem,
    ComboboxList,
    ComboboxValue,
    useComboboxAnchor,
} from '@/vdb/components/ui/combobox.js';
import { Label } from '@/vdb/components/ui/label.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import { useId, useState } from 'react';
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
    const [searchValue, setSearchValue] = useState('');
    const [manageDialogOpen, setManageDialogOpen] = useState(false);
    const queryClient = useQueryClient();
    const { t } = useLingui();
    const inputId = useId();
    const anchor = useComboboxAnchor();

    // Fetch available tags
    const { data: tagsData, isLoading } = useQuery({
        queryKey: ['tags'],
        queryFn: () => api.query(tagListDocument, { options: { take: 100 } }),
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

    const availableTags = (tagsData?.tags.items ?? []).map(tag => tag.value);

    // A search that matches no tag exactly is offered as a new tag, first in the list.
    const isNewTag =
        !!searchValue.trim() &&
        !availableTags.some(tag => tag.toLowerCase() === searchValue.trim().toLowerCase());
    const items = isNewTag ? [searchValue.trim(), ...availableTags] : availableTags;

    return (
        <div className="space-y-3">
            <Label htmlFor={inputId}>
                <Trans>Tags</Trans>
            </Label>

            <Combobox
                items={items}
                multiple
                value={selectedTags}
                onValueChange={(next: string[]) => {
                    const created = next.find(tag => !selectedTags.includes(tag) && !availableTags.includes(tag));
                    if (created) {
                        if (!createTagMutation.isPending) {
                            createTagMutation.mutate(created);
                        }
                        return;
                    }
                    onTagsChange(next);
                    setSearchValue('');
                }}
                inputValue={searchValue}
                onInputValueChange={setSearchValue}
                isLoading={isLoading || createTagMutation.isPending}
                disabled={disabled}
            >
                <ComboboxChips ref={anchor} className="w-full">
                    <ComboboxValue>
                        {(values: string[]) =>
                            values.map(tag => (
                                <ComboboxChip key={tag} removeLabel={t`Remove ${tag}`}>
                                    {tag}
                                </ComboboxChip>
                            ))
                        }
                    </ComboboxValue>
                    <ComboboxChipsInput
                        id={inputId}
                        placeholder={selectedTags.length === 0 ? t`Add tags...` : undefined}
                    />
                </ComboboxChips>
                <ComboboxContent anchor={anchor}>
                    <ComboboxEmpty>
                        <Trans>No tags found</Trans>
                    </ComboboxEmpty>
                    <ComboboxList>
                        {(tag: string) => (
                            <ComboboxItem key={tag} value={tag}>
                                {isNewTag && tag === searchValue.trim() ? (
                                    <Trans>Create "{searchValue.trim()}"</Trans>
                                ) : (
                                    tag
                                )}
                            </ComboboxItem>
                        )}
                    </ComboboxList>
                </ComboboxContent>
            </Combobox>

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
