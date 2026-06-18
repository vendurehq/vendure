import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Input } from '@/vdb/components/ui/input.js';
import { api } from '@/vdb/graphql/api.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { deleteTagDocument, tagListDocument, updateTagDocument } from '../assets.graphql.js';

interface ManageTagsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onTagsUpdated?: () => void;
}

export function ManageTagsDialog({ open, onOpenChange, onTagsUpdated }: Readonly<ManageTagsDialogProps>) {
    const queryClient = useQueryClient();
    const [toDelete, setToDelete] = useState<string[]>([]);
    const [toUpdate, setToUpdate] = useState<Array<{ id: string; value: string }>>([]);
    const [isSaving, setIsSaving] = useState(false);

    // Fetch all tags
    const { data: tagsData, isLoading } = useQuery({
        queryKey: ['tags'],
        queryFn: () => api.query(tagListDocument, { options: { take: 100 } }),
        staleTime: 1000 * 60 * 5,
    });

    // Update tag mutation
    const updateTagMutation = useMutation({
        mutationFn: ({ id, value }: { id: string; value: string }) =>
            api.mutate(updateTagDocument, { input: { id, value } }),
    });

    // Delete tag mutation
    const deleteTagMutation = useMutation({
        mutationFn: (id: string) => api.mutate(deleteTagDocument, { id }),
    });

    const allTags = tagsData?.tags.items || [];

    const toggleDelete = (id: string) => {
        if (toDelete.includes(id)) {
            setToDelete(toDelete.filter(_id => _id !== id));
        } else {
            setToDelete([...toDelete, id]);
        }
    };

    const markedAsDeleted = (id: string) => {
        return toDelete.includes(id);
    };

    const updateTagValue = (id: string, value: string) => {
        const exists = toUpdate.find(i => i.id === id);
        if (exists) {
            if (value === allTags.find(tag => tag.id === id)?.value) {
                // If value is reverted to original, remove from update list
                setToUpdate(toUpdate.filter(i => i.id !== id));
            } else {
                exists.value = value;
                setToUpdate([...toUpdate]);
            }
        } else {
            setToUpdate([...toUpdate, { id, value }]);
        }
    };

    const getDisplayValue = (id: string) => {
        const updateItem = toUpdate.find(i => i.id === id);
        if (updateItem) {
            return updateItem.value;
        }
        return allTags.find(tag => tag.id === id)?.value || '';
    };

    const renderTagsList = () => {
        if (isLoading) {
            return (
                <div className="text-sm text-muted-foreground">
                    <Trans>Loading tags...</Trans>
                </div>
            );
        }

        if (allTags.length === 0) {
            return (
                <div className="text-sm text-muted-foreground">
                    <Trans>No tags found</Trans>
                </div>
            );
        }

        return allTags.map(tag => {
            const isDeleted = markedAsDeleted(tag.id);
            const isModified = toUpdate.some(i => i.id === tag.id);

            return (
                <div
                    key={tag.id}
                    className={cn('flex items-center gap-2 p-2 rounded-md', isDeleted && 'opacity-50')}
                >
                    <Input
                        value={getDisplayValue(tag.id)}
                        onChange={e => updateTagValue(tag.id, e.target.value)}
                        disabled={isDeleted || isSaving}
                        className={cn('flex-1', isModified && !isDeleted && 'border-primary')}
                    />
                    <Button
                        variant={isDeleted ? 'default' : 'ghost'}
                        size="icon"
                        onClick={() => toggleDelete(tag.id)}
                        disabled={isSaving}
                        className={cn(isDeleted && 'bg-destructive hover:bg-destructive/90')}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            );
        });
    };

    const hasChanges = toDelete.length > 0 || toUpdate.length > 0;

    const handleCancel = () => {
        setToDelete([]);
        setToUpdate([]);
        onOpenChange(false);
    };

    const handleSave = async () => {
        setIsSaving(true);

        try {
            const operations = [];

            // Delete operations
            for (const id of toDelete) {
                operations.push(deleteTagMutation.mutateAsync(id));
            }

            // Update operations (skip if marked for deletion)
            for (const item of toUpdate) {
                if (!toDelete.includes(item.id)) {
                    operations.push(updateTagMutation.mutateAsync(item));
                }
            }

            await Promise.all(operations);

            // Invalidate tags query to refresh the list
            await queryClient.invalidateQueries({ queryKey: ['tags'] });

            // Also invalidate asset queries to refresh any assets using these tags
            await queryClient.invalidateQueries({ queryKey: ['asset'] });

            toast.success('Tags updated successfully');

            // Call callback to notify parent component
            if (onTagsUpdated) {
                onTagsUpdated();
            }

            // Reset state
            setToDelete([]);
            setToUpdate([]);
            onOpenChange(false);
        } catch (error) {
            toast.error('Failed to update tags', {
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Manage Tags</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>Edit or delete existing tags</Trans>
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-[400px] overflow-y-auto space-y-2 py-4">{renderTagsList()}</div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
                        {isSaving ? <Trans>Saving...</Trans> : <Trans>Save Changes</Trans>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
