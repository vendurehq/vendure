import * as React from "react";
import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/vdb/lib/utils.js";
import { useIsMobile } from "@/vdb/hooks/use-mobile.js";

const MOBILE_GUTTER = 5;
const MIN_CONTAINER_ROWS = 4;
const MAX_SEARCH_ROWS = 100;
const MAX_HEIGHT_FALLBACK = 999;
const Z_INDEX_WIDGET = 10;
const Z_INDEX_ACTIVE = 1000;

export interface GridLayout {
    x: number;
    y: number;
    w: number;
    h: number;
    i: string;
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
}

export interface GridLayoutProps {
    children: React.ReactElement[];
    layouts: GridLayout[];
    onLayoutChange?: (layouts: GridLayout[]) => void;
    cols?: number;
    rowHeight?: number;
    isDraggable?: boolean;
    isResizable?: boolean;
    className?: string;
    gutter?: number;
}

interface GridItemProps {
    layout: GridLayout;
    children: React.ReactNode;
    isDraggable?: boolean;
    isResizable?: boolean;
    onLayoutChange?: (layout: GridLayout) => void;
    onInteractionStart?: () => void;
    onInteractionEnd?: () => void;
    cols?: number;
    rowHeight?: number;
    gutter?: number;
}

function GridItem({
    layout,
    children,
    isDraggable = false,
    isResizable = false,
    onLayoutChange,
    onInteractionStart,
    onInteractionEnd,
    cols = 12,
    rowHeight = 100,
    gutter = 10,
}: GridItemProps) {
    const [isResizing, setIsResizing] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0, mouseX: 0, mouseY: 0 });
    const itemRef = useRef<HTMLDivElement>(null);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (!isDraggable || isResizing) return;
        e.preventDefault();
        e.stopPropagation();
        
        const rect = itemRef.current?.getBoundingClientRect();
        if (!rect) return;
        
        setIsDragging(true);
        onInteractionStart?.();
        setDragStart({
            x: layout.x,
            y: layout.y,
            mouseX: e.clientX,
            mouseY: e.clientY,
        });
    }, [isDraggable, isResizing, layout.x, layout.y, onInteractionStart]);

    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        if (!isResizable) return;
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
        onInteractionStart?.();
        setDragStart({
            x: layout.w,
            y: layout.h,
            mouseX: e.clientX,
            mouseY: e.clientY,
        });
    }, [isResizable, layout.w, layout.h, onInteractionStart]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!itemRef.current) return;
            
            const containerRect = itemRef.current.parentElement?.getBoundingClientRect();
            if (!containerRect) return;
            
            const colWidth = (containerRect.width - gutter * (cols - 1)) / cols;
            
            if (isDragging && onLayoutChange) {
                const deltaX = e.clientX - dragStart.mouseX;
                const deltaY = e.clientY - dragStart.mouseY;
                
                const newX = Math.round(dragStart.x + deltaX / colWidth);
                const newY = Math.round(dragStart.y + deltaY / rowHeight);
                
                onLayoutChange({
                    ...layout,
                    x: Math.max(0, Math.min(cols - layout.w, newX)),
                    y: Math.max(0, newY),
                });
            } else if (isResizing && onLayoutChange) {
                const deltaX = e.clientX - dragStart.mouseX;
                const deltaY = e.clientY - dragStart.mouseY;
                
                const newW = Math.round(dragStart.x + deltaX / colWidth);
                const newH = Math.round(dragStart.y + deltaY / rowHeight);
                
                // Apply min/max constraints
                const minW = layout.minW ?? 1;
                const minH = layout.minH ?? 1;
                const maxW = layout.maxW ?? (cols - layout.x);
                const maxH = layout.maxH ?? MAX_HEIGHT_FALLBACK;
                
                onLayoutChange({
                    ...layout,
                    w: Math.max(minW, Math.min(maxW, Math.min(cols - layout.x, newW))),
                    h: Math.max(minH, Math.min(maxH, newH)),
                });
            }
        };

        const handleMouseUp = () => {
            if (isDragging || isResizing) {
                onInteractionEnd?.();
            }
            setIsDragging(false);
            setIsResizing(false);
        };

        if (isDragging || isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging, isResizing, dragStart, layout, onLayoutChange, onInteractionEnd, cols, rowHeight]);

    const colWidth = `calc((100% - ${gutter * (cols - 1)}px) / ${cols})`;
    const style: React.CSSProperties = {
        position: 'absolute',
        left: `calc(${layout.x} * (${colWidth} + ${gutter}px))`,
        top: `calc(${layout.y} * (${rowHeight}px + ${gutter}px))`,
        width: `calc(${layout.w} * ${colWidth} + ${(layout.w - 1) * gutter}px)`,
        height: `calc(${layout.h} * ${rowHeight}px + ${(layout.h - 1) * gutter}px)`,
        zIndex: isDragging || isResizing ? Z_INDEX_ACTIVE : Z_INDEX_WIDGET,
    };

    return (
        <div
            ref={itemRef}
            style={style}
            className={cn(
                "transition-shadow",
                isDraggable && !isResizing && "cursor-move",
                (isDragging || isResizing) && "shadow-lg",
            )}
            onMouseDown={handleMouseDown}
        >
            <div className="h-full w-full">
                {children}
            </div>
            {isResizable && (
                <div
                    className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize bg-muted-foreground/20 hover:bg-muted-foreground/40 transition-colors"
                    style={{
                        clipPath: "polygon(100% 0%, 0% 100%, 100% 100%)",
                    }}
                    onMouseDown={handleResizeStart}
                />
            )}
        </div>
    );
}

export function GridLayout({
    children,
    layouts,
    onLayoutChange,
    cols = 12,
    rowHeight = 100,
    isDraggable = false,
    isResizable = false,
    className,
    gutter = 10,
}: GridLayoutProps) {
    const [showGrid, setShowGrid] = useState(false);
    const isMobile = useIsMobile();
    
    // Transform layouts for mobile - stack widgets vertically in full width
    const mobileLayouts = React.useMemo(() => {
        if (!isMobile) return layouts;
        
        return layouts.map((layout, index) => ({
            ...layout,
            x: 0,
            y: layouts.slice(0, index).reduce((sum, l) => sum + l.h, 0),
            w: cols, // Full width
        }));
    }, [layouts, isMobile, cols]);
    
    const effectiveLayouts = isMobile ? mobileLayouts : layouts;
    const effectiveGutter = isMobile ? MOBILE_GUTTER : gutter;
    const maxRow = Math.max(...effectiveLayouts.map(l => l.y + l.h), MIN_CONTAINER_ROWS);
    const containerHeight = maxRow * rowHeight + (maxRow - 1) * effectiveGutter;

    // Helper function to check if two layouts overlap
    const layoutsOverlap = (a: GridLayout, b: GridLayout): boolean => {
        return !(
            a.x + a.w <= b.x || // a is left of b
            b.x + b.w <= a.x || // b is left of a
            a.y + a.h <= b.y || // a is above b
            b.y + b.h <= a.y    // b is above a
        );
    };

    // Helper function to find the next available position for a widget
    const findNextAvailablePosition = (
        widget: GridLayout,
        occupiedLayouts: GridLayout[],
        draggedWidget?: GridLayout
    ): GridLayout => {
        const sortedLayouts = [...occupiedLayouts]
            .filter(l => l.i !== widget.i && (l.i !== draggedWidget?.i))
            .sort((a, b) => a.y === b.y ? a.x - b.x : a.y - b.y);

        // Try to place widget in rows, starting from its current position
        for (let y = widget.y; y < MAX_SEARCH_ROWS; y++) {
            for (let x = 0; x <= cols - widget.w; x++) {
                const testLayout = { ...widget, x, y };
                
                // Check if this position overlaps with any other widget
                const hasOverlap = sortedLayouts.some(layout => layoutsOverlap(testLayout, layout));
                
                // Also check overlap with dragged widget if provided
                if (!hasOverlap && (!draggedWidget || !layoutsOverlap(testLayout, draggedWidget))) {
                    return testLayout;
                }
            }
        }
        
        // Fallback: place at the bottom
        const maxY = Math.max(...sortedLayouts.map(l => l.y + l.h), 0);
        return { ...widget, x: 0, y: maxY };
    };

    const handleItemLayoutChange = useCallback((newLayout: GridLayout) => {
        if (onLayoutChange && !isMobile) { // Disable layout changes on mobile
            const newLayouts = [...layouts];
            const draggedIndex = layouts.findIndex(l => l.i === newLayout.i);
            
            if (draggedIndex === -1) return;
            
            // Update the dragged widget's position
            newLayouts[draggedIndex] = newLayout;
            
            // Find widgets that overlap with the new position
            const overlappingWidgets: number[] = [];
            
            for (let i = 0; i < newLayouts.length; i++) {
                if (i !== draggedIndex && layoutsOverlap(newLayout, newLayouts[i])) {
                    overlappingWidgets.push(i);
                }
            }
            
            // Move overlapping widgets to new positions
            for (const index of overlappingWidgets) {
                const widgetToMove = newLayouts[index];
                const newPosition = findNextAvailablePosition(widgetToMove, newLayouts, newLayout);
                newLayouts[index] = newPosition;
            }
            
            onLayoutChange(newLayouts);
        }
    }, [layouts, onLayoutChange, cols, isMobile]);

    const handleInteractionStart = useCallback(() => {
        setShowGrid(true);
    }, []);

    const handleInteractionEnd = useCallback(() => {
        setShowGrid(false);
    }, []);

    // Create grid overlay
    const renderGridOverlay = () => {
        if (!showGrid) return null;
        
        const gridCells = [];
        for (let row = 0; row < maxRow; row++) {
            for (let col = 0; col < cols; col++) {
                const colWidth = `calc((100% - ${effectiveGutter * (cols - 1)}px) / ${cols})`;
                const cellStyle: React.CSSProperties = {
                    position: 'absolute',
                    left: `calc(${col} * (${colWidth} + ${effectiveGutter}px))`,
                    top: `calc(${row} * (${rowHeight}px + ${effectiveGutter}px))`,
                    width: colWidth,
                    height: `${rowHeight}px`,
                    pointerEvents: 'none',
                    zIndex: 0, // Behind widgets but above background
                    boxSizing: 'border-box',
                };
                
                gridCells.push(
                    <div
                        key={`grid-${row}-${col}`}
                        style={cellStyle}
                        className="transition-opacity duration-200 border-2 border-dashed border-primary bg-primary/10"
                    />
                );
            }
        }
        
        return gridCells;
    };

    return (
        <div
            className={cn("relative w-full bg-muted/10", className)}
            style={{ 
                height: `${containerHeight}px`,
                backgroundImage: `
                    linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px),
                    linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)
                `,
                backgroundSize: `${100 / cols}% ${rowHeight}px`,
            }}
        >
            {children.map((child, index) => {
                const layout = effectiveLayouts[index];
                if (!layout) return null;

                return (
                    <GridItem
                        key={layout.i}
                        layout={layout}
                        isDraggable={isDraggable && !isMobile} // Disable dragging on mobile
                        isResizable={isResizable && !isMobile} // Disable resizing on mobile
                        onLayoutChange={handleItemLayoutChange}
                        onInteractionStart={handleInteractionStart}
                        onInteractionEnd={handleInteractionEnd}
                        cols={cols}
                        rowHeight={rowHeight}
                        gutter={effectiveGutter}
                    >
                        {child}
                    </GridItem>
                );
            })}
            {renderGridOverlay()}
        </div>
    );
}