import { Trans } from '@lingui/react/macro';
import { Bookmark } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useSavedViews } from '../../hooks/use-saved-views.js';
import { findMatchingSavedView } from '../../utils/saved-views-utils.js';
import { Button } from '../ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { useDataTableContext } from '@/vdb/hooks/use-data-table-context.js';
import { UserViewsSheet } from './user-views-sheet.js';

export const MyViewsButton: React.FC = () => {
    const [sheetOpen, setSheetOpen] = useState(false);
    const { userViews, savedViewsAreAvailable } = useSavedViews();
    const { columnFilters, searchTerm } = useDataTableContext();

    // Find the active view using centralized utility
    const activeView = useMemo(() => {
        return findMatchingSavedView(columnFilters, searchTerm, userViews);
    }, [userViews, columnFilters, searchTerm]);

    if (!savedViewsAreAvailable) {
        return null;
    }

    return (
        <>
            <div className="flex items-center gap-2">
                <Tooltip>
                    <TooltipTrigger render={<Button
                            variant={activeView ? 'default' : 'outline'}
                            size="icon-sm"
                            onClick={() => setSheetOpen(true)}
                        />}>
                            <Bookmark />
                    </TooltipTrigger>
                    <TooltipContent>
                        <Trans>My saved views</Trans>
                    </TooltipContent>
                </Tooltip>
                {activeView && <span className="text-sm text-muted-foreground">{activeView.name}</span>}
            </div>
            <UserViewsSheet open={sheetOpen} onOpenChange={setSheetOpen} />
        </>
    );
};
