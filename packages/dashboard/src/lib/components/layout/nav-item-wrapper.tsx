import { CopyableText } from '@/vdb/components/shared/copyable-text.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { cn } from '@/vdb/lib/utils.js';
import React, { useEffect, useState } from 'react';
import { DevModeButton } from '../../framework/layout-engine/dev-mode-button.js';

// Singleton state for hover tracking
let globalHoveredNavId: string | null = null;
const navHoverListeners: Set<(id: string | null) => void> = new Set();

const setGlobalHoveredNavId = (id: string | null) => {
    globalHoveredNavId = id;
    navHoverListeners.forEach(listener => listener(id));
};

export interface NavItemWrapperProps {
    children: React.ReactNode;
    locationId: string;
    order?: number;
    parentLocationId?: string;
    offset?: boolean;
}

export function NavItemWrapper({
    children,
    locationId,
    order,
    parentLocationId,
    offset,
}: Readonly<NavItemWrapperProps>) {
    const { settings } = useUserSettings();
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);
    const [hoveredId, setHoveredId] = useState<string | null>(globalHoveredNavId);

    const isHovered = hoveredId === locationId;

    // Subscribe to global hover changes
    useEffect(() => {
        const listener = (newHoveredId: string | null) => {
            setHoveredId(newHoveredId);
        };
        navHoverListeners.add(listener);
        return () => {
            navHoverListeners.delete(listener);
        };
    }, []);

    const setHoverId = (id: string | null) => {
        setGlobalHoveredNavId(id);
    };

    const handleMouseEnter = () => {
        setHoverId(locationId);
    };

    const handleMouseLeave = () => {
        // If we have a parent, fall back to the parent on mouse leave
        // Otherwise, clear the hover
        setHoverId(parentLocationId || null);
    };

    if (settings.devMode) {
        return (
            <div
                className={cn(
                    'ring-2 ring-transparent rounded-md transition-all delay-50 relative',
                    isHovered || isPopoverOpen ? 'ring-dev-mode ring-offset-1 ring-offset-background' : '',
                )}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                <div
                    className={cn(
                        `absolute right-0 transition-all delay-50 z-10`,
                        isHovered || isPopoverOpen ? 'visible' : 'invisible',
                        offset ? 'right-[26px] top-[3px]' : 'right-[3px] top-0.5 ',
                    )}
                >
                    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                        <PopoverTrigger render={<DevModeButton className={`h-5 w-5 top-0 end-0`} />} />
                        <PopoverContent className="w-48 p-3">
                            <div className="space-y-2">
                                <div className="space-y-1">
                                    <div className="text-xs">
                                        <div className="text-muted-foreground mb-0.5">locationId</div>
                                        <CopyableText value={locationId} />
                                    </div>
                                    {order !== undefined && (
                                        <div className="text-xs">
                                            <div className="text-muted-foreground mb-0.5">order</div>
                                            <CopyableText value={order.toString()} />
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
