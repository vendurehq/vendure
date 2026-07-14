import { Trans } from '@lingui/react/macro';
import { ChevronDown } from 'lucide-react';
import React from 'react';
import { useSavedViews } from '../../hooks/use-saved-views.js';
import { SavedView } from '../../types/saved-views.js';
import { findMatchingSavedView } from '../../utils/saved-views-utils.js';
import { PermissionGuard } from '../shared/permission-guard.js';
import { Button } from '../ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { useDataTableContext } from '@/vdb/hooks/use-data-table-context.js';
import { ManageGlobalViewsButton } from './manage-global-views-button.js';

export const GlobalViewsBar: React.FC = () => {
    const { globalViews, canManageGlobalViews } = useSavedViews();
    const { columnFilters, searchTerm, handleApplyView } = useDataTableContext();

    if (globalViews.length === 0) {
        return null;
    }

    const sortedViews = [...globalViews].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const handleViewClick = (view: SavedView) => {
        handleApplyView(view.filters, view.columnConfig, view.searchTerm);
    };

    const isViewActive = (view: SavedView) => {
        return findMatchingSavedView(columnFilters, searchTerm, [view]) !== undefined;
    };

    if (sortedViews.length <= 3) {
        // Show all views as buttons
        return (
            <div className="flex items-center gap-1">
                {sortedViews.map(view => (
                    <Button
                        key={view.id}
                        variant={isViewActive(view) ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleViewClick(view)}
                    >
                        {view.name}
                    </Button>
                ))}
                {canManageGlobalViews && <ManageGlobalViewsButton />}
            </div>
        );
    }

    // Show first 3 as buttons, rest in dropdown
    const visibleViews = sortedViews.slice(0, 3);
    const dropdownViews = sortedViews.slice(3);

    return (
        <div className="flex items-center gap-1">
            {visibleViews.map(view => (
                <Button
                    key={view.id}
                    variant={isViewActive(view) ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleViewClick(view)}
                >
                    {view.name}
                </Button>
            ))}
            <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                        <Trans>More views</Trans>
                        <ChevronDown className="h-3 w-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    {dropdownViews.map(view => (
                        <DropdownMenuItem
                            key={view.id}
                            onClick={() => handleViewClick(view)}
                            className={isViewActive(view) ? 'bg-primary' : ''}
                        >
                            {view.name}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
            <PermissionGuard requires={['WriteDashboardGlobalViews']}>
                {canManageGlobalViews && <ManageGlobalViewsButton />}
            </PermissionGuard>
        </div>
    );
};
