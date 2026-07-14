import { CopyableText } from '@/vdb/components/shared/copyable-text.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { cn } from '@/vdb/lib/utils.js';
import React, { useEffect, useState } from 'react';
import { DevModeButton } from './dev-mode-button.js';

// Singleton state for hover tracking across all action bar items
let globalHoveredActionBarItemId: string | null = null;
const actionBarHoverListeners: Set<(id: string | null) => void> = new Set();

const setGlobalHoveredActionBarItemId = (id: string | null) => {
    globalHoveredActionBarItemId = id;
    actionBarHoverListeners.forEach(listener => listener(id));
};

/**
 * Internal component that renders the dev-mode wrapper with hover highlight and popover.
 * Shared between ActionBarItem and ActionBarItemWrapper to eliminate duplication.
 */
function DevModeActionBarWrapper({
    children,
    itemId,
}: Readonly<{
    children: React.ReactNode;
    itemId: string;
}>) {
    const page = usePage();
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);
    const [hoveredId, setHoveredId] = useState<string | null>(globalHoveredActionBarItemId);

    // Generate a unique tracking ID that includes the page context
    const trackingId = `${page.pageId ?? 'unknown'}-actionbar-${itemId}`;
    const isHovered = hoveredId === trackingId;

    // Subscribe to global hover changes
    useEffect(() => {
        const listener = (newHoveredId: string | null) => {
            setHoveredId(newHoveredId);
        };
        actionBarHoverListeners.add(listener);
        return () => {
            actionBarHoverListeners.delete(listener);
        };
    }, []);

    const handleMouseEnter = () => {
        setGlobalHoveredActionBarItemId(trackingId);
    };

    const handleMouseLeave = () => {
        setGlobalHoveredActionBarItemId(null);
    };

    return (
        <div
            className={cn(
                'ring-1 ring-transparent rounded transition-all delay-50 relative',
                isHovered || isPopoverOpen ? 'ring-dev-mode ring-offset-1 ring-offset-background' : '',
            )}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div
                className={cn(
                    'absolute -top-1 -right-1 transition-all delay-50 z-10',
                    isHovered || isPopoverOpen ? 'visible' : 'invisible',
                )}
            >
                <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                    <PopoverTrigger render={<DevModeButton className="h-5 w-5 top-0 -start-4" />} />
                    <PopoverContent className="w-40 p-2">
                        <div className="space-y-1.5">
                            {page.pageId && (
                                <div className="text-xs">
                                    <div className="text-muted-foreground mb-0.5">pageId</div>
                                    <CopyableText value={page.pageId} />
                                </div>
                            )}
                            <div className="text-xs">
                                <div className="text-muted-foreground mb-0.5">itemId</div>
                                <CopyableText value={itemId} />
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
            {children}
        </div>
    );
}

/**
 * @description
 * Props for the ActionBarItem component.
 *
 * @docsCategory page-layout
 * @docsPage PageActionBar
 * @since 3.5.2
 */
export interface ActionBarItemProps {
    /**
     * @description
     * The content of the action bar item, typically a Button component.
     */
    children: React.ReactNode;
    /**
     * @description
     * A unique identifier for this action bar item. This ID is used by extensions
     * to position their items relative to this one via `position.itemId`.
     *
     * Note: Extensions should use this exact `itemId` value in their `position.itemId`
     * field to target this item.
     */
    itemId: string;
    /**
     * @description
     * If provided, the logged-in user must have one or more of the specified
     * permissions in order for the item to render.
     */
    requiresPermission?: string | string[];
}

/**
 * @description
 * A component for wrapping action bar items with a unique ID. This should be used inside
 * the {@link PageActionBarRight} component. Each item is given an `itemId` which allows
 * extensions to position their items relative to it using `position.itemId`.
 *
 * **Mobile behavior:** On mobile viewports, only the **last** inline `ActionBarItem` is
 * visible (treated as the primary action, e.g. Save/Update/Create). All other inline items
 * and extension items are hidden. Place your primary action as the last `ActionBarItem`
 * child of {@link PageActionBar}.
 *
 * In developer mode, hovering over the item will show a popover with the `pageId` and `itemId`,
 * making it easy to discover the correct IDs for extension positioning.
 *
 * @example
 * ```tsx
 * <PageActionBarRight>
 *     <ActionBarItem itemId="save-button" requiresPermission={['UpdateProduct']}>
 *         <Button type="submit">Save</Button>
 *     </ActionBarItem>
 * </PageActionBarRight>
 * ```
 *
 * @docsCategory page-layout
 * @docsPage PageActionBar
 * @since 3.5.2
 */
export function ActionBarItem({ children, itemId, requiresPermission }: Readonly<ActionBarItemProps>) {
    const { settings } = useUserSettings();

    const content = requiresPermission ? (
        <PermissionGuard requires={requiresPermission}>{children}</PermissionGuard>
    ) : (
        children
    );

    if (settings.devMode) {
        return <DevModeActionBarWrapper itemId={itemId}>{content}</DevModeActionBarWrapper>;
    }
    return <>{content}</>;
}

/**
 * Internal wrapper component used by PageActionBarRight to wrap extension items
 * with dev-mode location information. Unlike ActionBarItem, this does not handle
 * permissions (those are handled by PageActionBarItem).
 *
 * @internal
 */
export function ActionBarItemWrapper({
    children,
    itemId,
}: Readonly<{
    children: React.ReactNode;
    itemId: string;
}>) {
    const { settings } = useUserSettings();

    if (settings.devMode) {
        return <DevModeActionBarWrapper itemId={itemId}>{children}</DevModeActionBarWrapper>;
    }
    return <>{children}</>;
}
