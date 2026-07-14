import { CopyableText } from '@/vdb/components/shared/copyable-text.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { DevModeButton } from '@/vdb/framework/layout-engine/dev-mode-button.js';
import { cn } from '@/vdb/lib/utils.js';
import React, { useEffect, useState } from 'react';

// Singleton state for hover tracking across all toolbar items
let globalHoveredToolbarItemId: string | null = null;
const toolbarHoverListeners: Set<(id: string | null) => void> = new Set();

const setGlobalHoveredToolbarItemId = (id: string | null) => {
    globalHoveredToolbarItemId = id;
    toolbarHoverListeners.forEach(listener => listener(id));
};

/**
 * Dev-mode wrapper for toolbar items. Shows a highlight ring and popover
 * with the item's ID on hover, making it easy to discover IDs for extension
 * positioning.
 *
 * @internal
 */
export function DevModeToolbarItemWrapper({
    children,
    itemId,
}: Readonly<{
    children: React.ReactNode;
    itemId: string;
}>) {
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);
    const [hoveredId, setHoveredId] = useState<string | null>(globalHoveredToolbarItemId);

    const trackingId = `toolbar-${itemId}`;
    const isHovered = hoveredId === trackingId;

    useEffect(() => {
        const listener = (newHoveredId: string | null) => {
            setHoveredId(newHoveredId);
        };
        toolbarHoverListeners.add(listener);
        return () => {
            toolbarHoverListeners.delete(listener);
        };
    }, []);

    const handleMouseEnter = () => {
        setGlobalHoveredToolbarItemId(trackingId);
    };

    const handleMouseLeave = () => {
        setGlobalHoveredToolbarItemId(null);
    };

    return (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
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
                        <div className="text-xs">
                            <div className="text-muted-foreground mb-0.5">itemId</div>
                            <CopyableText value={itemId} />
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
            {children}
        </div>
    );
}
