import { Trans } from '@lingui/react/macro';
import { BookmarkPlus } from 'lucide-react';
import React, { useState } from 'react';
import { useSavedViews } from '../../hooks/use-saved-views.js';
import { isMatchingSavedView } from '../../utils/saved-views-utils.js';
import { Button } from '../ui/button.js';
import { useDataTableContext } from '@/vdb/hooks/use-data-table-context.js';
import { SaveViewDialog } from './save-view-dialog.js';

interface SaveViewButtonProps {
    disabled?: boolean;
}

export const SaveViewButton: React.FC<SaveViewButtonProps> = ({ disabled }) => {
    const [dialogOpen, setDialogOpen] = useState(false);
    const { userViews, globalViews, savedViewsAreAvailable } = useSavedViews();
    const { columnFilters, searchTerm } = useDataTableContext();

    const hasFilters = columnFilters.length > 0 || (searchTerm && searchTerm.length > 0);
    const matchesExistingView = isMatchingSavedView(columnFilters, searchTerm || '', userViews, globalViews);

    // Don't show the button if there are no filters or if filters match an existing saved view
    if (!hasFilters || matchesExistingView) {
        return null;
    }

    if (!savedViewsAreAvailable) {
        return null;
    }

    return (
        <>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)} disabled={disabled}>
                <BookmarkPlus className="h-4 w-4 mr-1" />
                <Trans>Save View</Trans>
            </Button>
            <SaveViewDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                filters={columnFilters}
                searchTerm={searchTerm}
            />
        </>
    );
};
