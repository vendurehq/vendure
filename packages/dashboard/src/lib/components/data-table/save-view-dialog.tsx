import { ColumnFiltersState } from '@tanstack/react-table';
import React, { useState } from 'react';
import { useSavedViews } from '../../hooks/use-saved-views.js';
import { Button } from '../ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group.js';
import { toast } from '@/vdb/components/ui/sonner.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';

interface SaveViewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    filters: ColumnFiltersState;
    searchTerm?: string;
}

export const SaveViewDialog: React.FC<SaveViewDialogProps> = ({
    open,
    onOpenChange,
    filters,
    searchTerm,
}) => {
    const [name, setName] = useState('');
    const [scope, setScope] = useState<'user' | 'global'>('user');
    const [saving, setSaving] = useState(false);
    const { saveView, userViews, globalViews, canManageGlobalViews } = useSavedViews();
    const { pageId } = usePage();
    const { settings } = useUserSettings();

    const defaultVisibility = {
        id: false,
        createdAt: false,
        updatedAt: false,
        type: false,
        currencyCode: false,
    }
    const tableSettings = pageId ? settings.tableSettings?.[pageId] : undefined;
    const columnVisibility = pageId
        ? (tableSettings?.columnVisibility ?? defaultVisibility)
        : defaultVisibility;
    const columnOrder = pageId ? (tableSettings?.columnOrder ?? []) : [];

    const handleSave = async () => {
        if (!name.trim()) {
            toast.error('Please enter a name for the view');
            return;
        }

        // Check for duplicate names
        const existingViews = scope === 'user' ? userViews : globalViews;
        if (existingViews.some(v => v.name === name.trim())) {
            toast.error(`A ${scope} view with this name already exists`);
            return;
        }

        setSaving(true);
        try {
            await saveView({
                name: name.trim(),
                scope,
                filters,
                columnConfig : {
                    columnVisibility,
                    columnOrder,
                },
                searchTerm,
            });
            toast.success(`View "${name}" saved successfully`);
            onOpenChange(false);
            setName('');
            setScope('user');
        } catch (error) {
            toast.error('Failed to save view');
            console.error('Failed to save view:', error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Save Current View</DialogTitle>
                    <DialogDescription>
                        Save the current filters and search term as a reusable view.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="view-name">View Name</Label>
                        <Input
                            id="view-name"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Enter a name for this view"
                            autoFocus
                        />
                    </div>
                    {canManageGlobalViews && (
                        <div className="space-y-2">
                            <Label>View Scope</Label>
                            <RadioGroup value={scope} onValueChange={value => setScope(value as 'user' | 'global')}>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="user" id="scope-user" />
                                    <Label htmlFor="scope-user" className="font-normal">
                                        Personal View (only visible to you)
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="global" id="scope-global" />
                                    <Label htmlFor="scope-global" className="font-normal">
                                        Global View (visible to all users)
                                    </Label>
                                </div>
                            </RadioGroup>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={saving || !name.trim()}>
                        {saving ? 'Saving...' : 'Save View'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};