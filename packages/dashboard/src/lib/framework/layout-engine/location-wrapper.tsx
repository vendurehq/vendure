import { CopyableText } from '@/vdb/components/shared/copyable-text.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { usePageBlock } from '@/vdb/hooks/use-page-block.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { cn } from '@/vdb/lib/utils.js';
import React, { useEffect, useState } from 'react';
import { DevModeButton } from './dev-mode-button.js';

// Singleton state for hover tracking
let globalHoveredId: string | null = null;
const hoverListeners: Set<(id: string | null) => void> = new Set();

const setGlobalHoveredId = (id: string | null) => {
    globalHoveredId = id;
    hoverListeners.forEach(listener => listener(id));
};

export interface LocationWrapperProps {
    children: React.ReactNode;
    identifier?: string;
}

export function LocationWrapper({ children, identifier }: Readonly<LocationWrapperProps>) {
    const page = usePage();
    const pageBlock = usePageBlock({ optional: true });
    const { settings } = useUserSettings();
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);
    const blockId = pageBlock?.blockId ?? null;
    const isPageWrapper = !blockId;

    const [hoveredId, setHoveredId] = useState<string | null>(globalHoveredId);
    const id = `${page.pageId}-${blockId ?? 'page'}-${identifier ?? ''}`;
    const isHovered = hoveredId === id;

    // Subscribe to global hover changes
    useEffect(() => {
        const listener = (newHoveredId: string | null) => {
            setHoveredId(newHoveredId);
        };
        hoverListeners.add(listener);
        return () => {
            hoverListeners.delete(listener);
        };
    }, []);

    const setHoverId = (id: string | null) => {
        setGlobalHoveredId(id);
    };

    const handleMouseEnter = () => {
        // Set this element as hovered
        setHoverId(id);
    };

    const handleMouseLeave = () => {
        // If we're at the top level (page wrapper), go to null
        // If we're at block level, go to page level
        // If we're at identifier level, go to block level
        if (isPageWrapper) {
            setHoverId(null);
        } else if (blockId && !identifier) {
            // Block level - go to page level
            setHoverId(`${page.pageId}-page-`);
        } else if (identifier) {
            // Identifier level - go to block level
            setHoverId(`${page.pageId}-${blockId}-`);
        }
    };

    if (settings.devMode) {
        const pageId = page.pageId;
        return (
            <div
                className={cn(
                    `ring-2 transition-all delay-50 relative rounded-none`,
                    isHovered || isPopoverOpen
                        ? 'ring-dev-mode ring-offset-4 ring-offset-background'
                        : 'ring-transparent ring-offset-0',
                    isPageWrapper && (isHovered || isPopoverOpen) ? 'ring-offset-8' : '',
                )}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                <div
                    className={`absolute top-1 right-1 transition-all delay-50 z-10 ${isHovered || isPopoverOpen ? 'visible' : 'invisible'}`}
                >
                    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                        <PopoverTrigger
                            render={
                                <DevModeButton
                                    className={isPageWrapper ? '-top-8 -end-1 border-2' : '-top-4 -end-4'}
                                />
                            }
                        />
                        <PopoverContent className="w-48 p-3">
                            <div className="space-y-2">
                                <div className="space-y-1">
                                    {pageId && (
                                        <div className="text-xs">
                                            <div className="text-muted-foreground mb-0.5">pageId</div>
                                            <CopyableText value={pageId} />
                                        </div>
                                    )}
                                    {blockId && (
                                        <div className="text-xs">
                                            <div className="text-muted-foreground mb-0.5">blockId</div>
                                            <CopyableText value={blockId} />
                                        </div>
                                    )}
                                    {identifier && (
                                        <div className="text-xs">
                                            <div className="text-muted-foreground mb-0.5">identifier</div>
                                            <CopyableText value={identifier} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
                {children}
            </div>
        );
    }
    return children;
}
