import { CopyableText } from '@/vdb/components/shared/copyable-text.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { usePageBlock } from '@/vdb/hooks/use-page-block.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { cn } from '@/vdb/lib/utils.js';
import React, { useEffect, useState } from 'react';
import { DevModeButton } from '../../framework/layout-engine/dev-mode-button.js';

// Singleton state for hover tracking
let globalHoveredColumnId: string | null = null;
const columnHoverListeners: Set<(id: string | null) => void> = new Set();

const setGlobalHoveredColumnId = (id: string | null) => {
    globalHoveredColumnId = id;
    columnHoverListeners.forEach(listener => listener(id));
};

export interface ColumnHeaderWrapperProps {
    children: React.ReactNode;
    columnId: string;
}

export function ColumnHeaderWrapper({ children, columnId }: Readonly<ColumnHeaderWrapperProps>) {
    const { settings } = useUserSettings();
    const page = usePage();
    const pageBlock = usePageBlock({ optional: true });
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);
    const [hoveredId, setHoveredId] = useState<string | null>(globalHoveredColumnId);
    const blockId = pageBlock?.blockId ?? null;
    const pageId = page.pageId;
    const isHovered = hoveredId === columnId;

    // Subscribe to global hover changes
    useEffect(() => {
        const listener = (newHoveredId: string | null) => {
            setHoveredId(newHoveredId);
        };
        columnHoverListeners.add(listener);
        return () => {
            columnHoverListeners.delete(listener);
        };
    }, []);

    const setHoverId = (id: string | null) => {
        setGlobalHoveredColumnId(id);
    };

    const handleMouseEnter = () => {
        setHoverId(columnId);
    };

    const handleMouseLeave = () => {
        setHoverId(null);
    };

    if (settings.devMode) {
        return (
            <div
                className={cn(
                    'ring-2 ring-transparent rounded-md transition-all delay-50 relative min-h-8 flex flex-col justify-center',
                    isHovered || isPopoverOpen ? 'ring-dev-mode ring-offset-1 ring-offset-background' : '',
                )}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                <div
                    className={cn(
                        `absolute right-0 top-0 transition-all delay-50 z-10`,
                        isHovered || isPopoverOpen ? 'visible' : 'invisible',
                    )}
                >
                    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                        <PopoverTrigger render={<DevModeButton className={`h-5 w-5 end-1 top-1`} />} />
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
                                    <div className="text-xs">
                                        <div className="text-muted-foreground mb-0.5">column</div>
                                        <CopyableText value={columnId} />
                                    </div>
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
