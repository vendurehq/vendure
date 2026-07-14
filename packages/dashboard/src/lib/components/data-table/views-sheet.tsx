import { Trans, useLingui } from '@lingui/react/macro';
import { Copy, Edit, Globe, MoreHorizontal, Trash2 } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from '@/vdb/components/ui/sonner.js';
import { useSavedViews } from '../../hooks/use-saved-views.js';
import { SavedView } from '../../types/saved-views.js';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '../ui/alert-dialog.js';
import { Button } from '../ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { Input } from '../ui/input.js';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet.js';
import { useDataTableContext } from '@/vdb/hooks/use-data-table-context.js';

interface ViewsSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    type: 'user' | 'global';
}

export const ViewsSheet: React.FC<ViewsSheetProps> = ({ open, onOpenChange, type }) => {
    const { userViews, globalViews, deleteView, updateView, duplicateView, canManageGlobalViews } =
        useSavedViews();
    const { handleApplyView } = useDataTableContext();
    const { t } = useLingui();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    const views = type === 'global' ? globalViews : userViews;
    const isGlobal = type === 'global';

    const handleViewApply = (view: SavedView) => {
        handleApplyView(view.filters,view.columnConfig, view.searchTerm);
        const viewName = view.name;
        const message = isGlobal ? t`Applied global view "${viewName}"` : t`Applied view "${viewName}"`;
        toast.success(message);
    };

    const handleStartEdit = (view: SavedView) => {
        setEditingId(view.id);
        setEditingName(view.name);
    };

    const handleSaveEdit = async () => {
        if (!editingId || !editingName.trim()) return;

        try {
            await updateView({ id: editingId, name: editingName.trim() });
            const message = isGlobal ? t`Global view renamed successfully` : t`View renamed successfully`;
            toast.success(message);
            setEditingId(null);
            setEditingName('');
        } catch (error) {
            const message = isGlobal ? t`Failed to rename global view` : t`Failed to rename view`;
            toast.error(message);
        }
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditingName('');
    };

    const handleDelete = async () => {
        if (!deleteConfirmId) return;

        try {
            await deleteView(deleteConfirmId);
            const message = isGlobal ? t`Global view deleted successfully` : t`View deleted successfully`;
            toast.success(message);
            setDeleteConfirmId(null);
        } catch (error) {
            const message = isGlobal ? t`Failed to delete global view` : t`Failed to delete view`;
            toast.error(message);
        }
    };

    const handleDuplicate = async (view: SavedView) => {
        try {
            await duplicateView(view.id, type);
            const message = isGlobal
                ? t`Global view duplicated successfully`
                : t`View duplicated successfully`;
            toast.success(message);
        } catch (error) {
            const message = isGlobal ? t`Failed to duplicate global view` : t`Failed to duplicate view`;
            toast.error(message);
        }
    };

    const handleConvertToUser = async (view: SavedView) => {
        try {
            await duplicateView(view.id, 'user');
            toast.success(t`Global view converted to personal view successfully`);
        } catch (error) {
            toast.error(t`Failed to convert global view to personal view`);
        }
    };

    const handleConvertToGlobal = async (view: SavedView) => {
        try {
            await duplicateView(view.id, 'global');
            await deleteView(view.id);
            toast.success(t`View converted to global successfully`);
        } catch (error) {
            toast.error(t`Failed to convert view to global`);
        }
    };

    const getTitle = () => {
        return isGlobal ? <Trans>Manage Global Views</Trans> : <Trans>My Saved Views</Trans>;
    };

    const getDescription = () => {
        return isGlobal ? (
            <Trans>Manage global saved views that are visible to all users</Trans>
        ) : (
            <Trans>Manage your personal saved views for this table</Trans>
        );
    };

    const getEmptyStateMessage = () => {
        if (isGlobal) {
            return (
                <>
                    <p>
                        <Trans>No global views have been created yet.</Trans>
                    </p>
                    <p className="text-sm mt-2">
                        <Trans>Save a view as "Global" to make it available to all users.</Trans>
                    </p>
                </>
            );
        } else {
            return (
                <>
                    <p>
                        <Trans>You haven't saved any views yet.</Trans>
                    </p>
                    <p className="text-sm mt-2">
                        <Trans>Apply filters to the table and click "Save View" to get started.</Trans>
                    </p>
                </>
            );
        }
    };

    const getDeleteDialogTitle = () => {
        return isGlobal ? <Trans>Delete Global View</Trans> : <Trans>Delete View</Trans>;
    };

    const getDeleteDialogDescription = () => {
        return isGlobal ? (
            <Trans>
                Are you sure you want to delete this global view? This action cannot be undone and will affect
                all users.
            </Trans>
        ) : (
            <Trans>Are you sure you want to delete this view? This action cannot be undone.</Trans>
        );
    };

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent className="w-[400px] sm:w-[540px]">
                    <SheetHeader>
                        <SheetTitle>{getTitle()}</SheetTitle>
                        <SheetDescription>{getDescription()}</SheetDescription>
                    </SheetHeader>
                    <div className="mt-4">
                        {views.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                                {getEmptyStateMessage()}
                            </div>
                        ) : (
                            <div className="divide-y">
                                {views.map(view => (
                                    <div
                                        key={view.id}
                                        className="flex items-center justify-between py-3 first:pt-0 last:pb-0 hover:bg-accent/50 transition-colors rounded-md px-2"
                                    >
                                        {editingId === view.id ? (
                                            <div className="flex items-center gap-2 flex-1">
                                                <Input
                                                    value={editingName}
                                                    onChange={e => setEditingName(e.target.value)}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') handleSaveEdit();
                                                        if (e.key === 'Escape') handleCancelEdit();
                                                    }}
                                                    autoFocus
                                                    className="flex-1"
                                                />
                                                <Button size="sm" onClick={handleSaveEdit}>
                                                    <Trans>Save</Trans>
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={handleCancelEdit}
                                                >
                                                    <Trans>Cancel</Trans>
                                                </Button>
                                            </div>
                                        ) : (
                                            <>
                                                <span className="font-medium text-sm truncate flex-1">
                                                    {view.name}
                                                </span>
                                                <div className="flex items-center gap-1">
                                                    <Button size="sm" onClick={() => handleViewApply(view)}>
                                                        <Trans>Apply</Trans>
                                                    </Button>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
                                                                <MoreHorizontal className="h-4 w-4" />
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem
                                                                onClick={() => handleStartEdit(view)}
                                                            >
                                                                <Edit className="h-4 w-4 mr-2" />
                                                                <Trans>Rename</Trans>
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => handleDuplicate(view)}
                                                            >
                                                                <Copy className="h-4 w-4 mr-2" />
                                                                <Trans>Duplicate</Trans>
                                                            </DropdownMenuItem>
                                                            {isGlobal ? (
                                                                <DropdownMenuItem
                                                                    onClick={() => handleConvertToUser(view)}
                                                                >
                                                                    <Copy className="h-4 w-4 mr-2" />
                                                                    <Trans>Copy to Personal</Trans>
                                                                </DropdownMenuItem>
                                                            ) : (
                                                                canManageGlobalViews && (
                                                                    <DropdownMenuItem
                                                                        onClick={() =>
                                                                            handleConvertToGlobal(view)
                                                                        }
                                                                    >
                                                                        <Globe className="h-4 w-4 mr-2" />
                                                                        <Trans>Make Global</Trans>
                                                                    </DropdownMenuItem>
                                                                )
                                                            )}
                                                            <DropdownMenuItem
                                                                onClick={() => setDeleteConfirmId(view.id)}
                                                                className="text-destructive"
                                                            >
                                                                <Trash2 className="h-4 w-4 mr-2" />
                                                                <Trans>Delete</Trans>
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </SheetContent>
            </Sheet>

            <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{getDeleteDialogTitle()}</AlertDialogTitle>
                        <AlertDialogDescription>{getDeleteDialogDescription()}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>
                            <Trans>Cancel</Trans>
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>
                            <Trans>Delete</Trans>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
