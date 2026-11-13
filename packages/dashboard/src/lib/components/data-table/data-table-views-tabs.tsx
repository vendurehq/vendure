import { useDataTableContext } from '@/vdb/hooks/use-data-table-context.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans } from '@lingui/react/macro';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import React, { useState } from 'react';
import { useSavedViews } from '../../hooks/use-saved-views.js';
import { SavedView } from '../../types/saved-views.js';
import { ColumnConfig } from './data-table-context.js';
import { findMatchingSavedView } from '../../utils/saved-views-utils.js';
import { Button } from '../ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs.js';
import { GlobalViewsSheet } from './global-views-sheet.js';
import { SaveViewDialog } from './save-view-dialog.js';
import { UserViewsSheet } from './user-views-sheet.js';

const INLINE_TAB_LIMIT = 5;

/**
 * @description
 * Renders the table's saved views as a row of tabs: an "All" tab (no filters),
 * global views, then the user's own views. When the current filter state does
 * not match any saved view, an "Unsaved view" affordance with an inline Save
 * action appears instead of a separate save button. Management of views lives
 * behind the trailing "…" menu.
 *
 * @docsCategory list-views
 * @since 3.8.0
 */
export const DataTableViewsTabs: React.FC = () => {
    const { userViews, globalViews, savedViewsAreAvailable, canManageGlobalViews } = useSavedViews();
    const { columnFilters, searchTerm, handleApplyView } = useDataTableContext();
    const [saveDialogOpen, setSaveDialogOpen] = useState(false);
    const [userSheetOpen, setUserSheetOpen] = useState(false);
    const [globalSheetOpen, setGlobalSheetOpen] = useState(false);

    if (!savedViewsAreAvailable) {
        return null;
    }

    const sortedGlobalViews = [...globalViews].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const allViews = [...sortedGlobalViews, ...userViews];
    const hasActiveFilters = columnFilters.length > 0 || searchTerm.trim().length > 0;
    const activeView = findMatchingSavedView(columnFilters, searchTerm, allViews);
    const isUnsaved = hasActiveFilters && !activeView;

    const applyView = (view: SavedView) => {
        handleApplyView(view.filters, view.columnConfig, view.searchTerm ?? '');
    };
    // An empty ColumnConfig leaves the user's column order/visibility untouched —
    // the "All" tab only clears filters and search.
    const applyAllTab = () => handleApplyView([], {} as ColumnConfig, '');

    const inlineViews = allViews.slice(0, INLINE_TAB_LIMIT);
    const overflowViews = allViews.slice(INLINE_TAB_LIMIT);

    // The active "tab" is derived from filter state rather than owned by the
    // Tabs primitive: 'all' when unfiltered, the matching view's id, or no tab
    // at all when the state is unsaved or matches an overflowed view.
    const activeTabValue = !hasActiveFilters ? 'all' : (activeView?.id ?? null);
    const handleTabChange = (value: unknown) => {
        if (value === 'all') {
            applyAllTab();
            return;
        }
        const view = allViews.find(v => v.id === value);
        if (view) {
            applyView(view);
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-1" data-testid="dt-views-tabs">
            <Tabs value={activeTabValue} onValueChange={handleTabChange}>
                <TabsList variant="line">
                    <TabsTrigger value="all">
                        <Trans>All</Trans>
                    </TabsTrigger>
                    {inlineViews.map(view => (
                        <TabsTrigger key={view.id} value={view.id}>
                            {view.name}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>
            {overflowViews.length > 0 && (
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <button
                                type="button"
                                className={cn(
                                    'flex items-center gap-1 px-2 py-1 text-sm rounded-md text-muted-foreground whitespace-nowrap transition-colors hover:text-foreground',
                                    overflowViews.some(v => v.id === activeView?.id) &&
                                        'text-foreground font-medium',
                                )}
                            />
                        }
                    >
                        <span className="flex items-center gap-1">
                            <Trans>More</Trans>
                            <ChevronDown className="h-3 w-3" />
                        </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        {overflowViews.map(view => (
                            <DropdownMenuItem key={view.id} onClick={() => applyView(view)}>
                                {view.name}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
            {isUnsaved && (
                <div className="flex items-center gap-1 rounded-md border border-dashed border-input pl-2.5 pr-1 py-0.5 text-sm">
                    <span className="text-muted-foreground">
                        <Trans>Unsaved view</Trans>
                    </span>
                    <Button
                        variant="secondary"
                        size="sm"
                        className="h-6 px-2 text-xs font-medium"
                        onClick={() => setSaveDialogOpen(true)}
                    >
                        <Trans>Save</Trans>
                    </Button>
                </div>
            )}
            <DropdownMenu>
                <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground" />}
                >
                    <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => setUserSheetOpen(true)}>
                        <Trans>Manage my views</Trans>
                    </DropdownMenuItem>
                    {canManageGlobalViews && (
                        <DropdownMenuItem onClick={() => setGlobalSheetOpen(true)}>
                            <Trans>Manage global views</Trans>
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            <SaveViewDialog
                open={saveDialogOpen}
                onOpenChange={setSaveDialogOpen}
                filters={columnFilters}
                searchTerm={searchTerm}
            />
            <UserViewsSheet open={userSheetOpen} onOpenChange={setUserSheetOpen} />
            {canManageGlobalViews && <GlobalViewsSheet open={globalSheetOpen} onOpenChange={setGlobalSheetOpen} />}
        </div>
    );
};
