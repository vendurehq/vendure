import { AppSidebar } from '@/vdb/components/layout/app-sidebar.js';
import { DevModeIndicator } from '@/vdb/components/layout/dev-mode-indicator.js';
import { GeneratedBreadcrumbs } from '@/vdb/components/layout/generated-breadcrumbs.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Separator } from '@/vdb/components/ui/separator.js';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/vdb/components/ui/sidebar.js';
import {
    DashboardToolbarItemDefinition,
    ToolbarItemPosition,
} from '@/vdb/framework/extension-api/types/toolbar.js';
import { getToolbarItemRegistry } from '@/vdb/framework/toolbar/toolbar-extensions.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { Outlet } from '@tanstack/react-router';
import React from 'react';
import { Alerts } from '../shared/alerts.js';
import { DevModeToolbarItemWrapper } from './toolbar-item-wrapper.js';

interface BuiltInToolbarItem {
    id: string;
    component: React.FunctionComponent;
    shouldRender?: boolean;
}

type MergedToolbarItem =
    | { type: 'builtin'; item: BuiltInToolbarItem }
    | { type: 'extension'; item: DashboardToolbarItemDefinition };

/**
 * Merges built-in toolbar items with extension items, applying position-based ordering.
 * Uses the same priority sorting as action bar items: before=1, replace=2, after=3.
 */
function mergeToolbarItems(
    builtinItems: BuiltInToolbarItem[],
    extensionItems: DashboardToolbarItemDefinition[],
): MergedToolbarItem[] {
    const result: MergedToolbarItem[] = [];

    // First, add extension items WITHOUT a position (they go first)
    const unpositionedExtensions = extensionItems.filter(ext => !ext.position);
    for (const ext of unpositionedExtensions) {
        result.push({ type: 'extension', item: ext });
    }

    // Process each built-in item and find extension items targeting it
    for (const builtinItem of builtinItems) {
        const matchingExtensions = extensionItems.filter(ext => ext.position?.itemId === builtinItem.id);

        // Sort by order priority: before=1, replace=2, after=3
        const orderPriority: Record<ToolbarItemPosition['order'], number> = {
            before: 1,
            replace: 2,
            after: 3,
        };
        const sortedExtensions = [...matchingExtensions].sort(
            (a, b) => orderPriority[a.position!.order] - orderPriority[b.position!.order],
        );

        const hasReplacement = sortedExtensions.some(ext => ext.position?.order === 'replace');

        let builtinInserted = false;
        for (const ext of sortedExtensions) {
            // Insert built-in item before the first non-"before" extension (if not replaced)
            if (!builtinInserted && !hasReplacement && ext.position?.order !== 'before') {
                result.push({ type: 'builtin', item: builtinItem });
                builtinInserted = true;
            }
            result.push({ type: 'extension', item: ext });
        }

        // If all extensions were "before" or there were no extensions, add built-in at the end
        if (!builtinInserted && !hasReplacement) {
            result.push({ type: 'builtin', item: builtinItem });
        }
    }

    return result;
}

function ToolbarItems() {
    const { settings } = useUserSettings();
    const extensionItems = Array.from(getToolbarItemRegistry().values());

    const builtinItems: BuiltInToolbarItem[] = [
        {
            id: 'dev-mode-indicator',
            component: DevModeIndicator,
            shouldRender: settings.devMode,
        },
        {
            id: 'alerts',
            component: Alerts,
        },
    ];

    const mergedItems = mergeToolbarItems(builtinItems, extensionItems);

    return (
        <>
            {mergedItems.map(merged => {
                if (merged.type === 'builtin') {
                    const { item } = merged;
                    if (item.shouldRender === false) {
                        return null;
                    }
                    const content = <item.component />;
                    if (settings.devMode) {
                        return (
                            <DevModeToolbarItemWrapper key={item.id} itemId={item.id}>
                                {content}
                            </DevModeToolbarItemWrapper>
                        );
                    }
                    return <React.Fragment key={item.id}>{content}</React.Fragment>;
                }

                const { item } = merged;
                const content = (
                    <PermissionGuard requires={item.requiresPermission ?? []}>
                        <item.component />
                    </PermissionGuard>
                );
                if (settings.devMode) {
                    return (
                        <DevModeToolbarItemWrapper key={item.id} itemId={item.id}>
                            {content}
                        </DevModeToolbarItemWrapper>
                    );
                }
                return <React.Fragment key={item.id}>{content}</React.Fragment>;
            })}
        </>
    );
}

export function AppLayout() {
    return (
        <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
                <div className="container mx-auto">
                    <header className="border-b border-border flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
                        <div className="flex items-center justify-between gap-2 px-4 w-full">
                            <div className="flex items-center justify-start gap-2 min-w-0 overflow-hidden">
                                <SidebarTrigger className="-ml-1 shrink-0" />
                                <Separator orientation="vertical" className="mr-2 shrink-0" />
                                <GeneratedBreadcrumbs />
                            </div>
                            <div className="flex items-center justify-end gap-2 shrink-0">
                                <ToolbarItems />
                            </div>
                        </div>
                    </header>
                    <Outlet />
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
}
