import { useIsMobile } from '@/vdb/hooks/use-mobile.js';
import { cn } from '@/vdb/lib/utils.js';
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

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

const DEFAULT_COLS = 12;

/**
 * Returns true when the two grid items occupy any of the same cells.
 */
export function layoutsOverlap(a: GridLayout, b: GridLayout): boolean {
    return !(
        a.x + a.w <= b.x || // a is left of b
        b.x + b.w <= a.x || // b is left of a
        a.y + a.h <= b.y || // a is above b
        b.y + b.h <= a.y // b is above a
    );
}

/**
 * Finds the next free position for `widget`, scanning row by row (starting from the widget's
 * current row) and left to right. `anchor`, when provided, is treated as immovable so the
 * widget flows around it. Falls back to placing the widget below everything else.
 */
export function findNextAvailablePosition(
    widget: GridLayout,
    occupiedLayouts: GridLayout[],
    anchor?: GridLayout,
    cols: number = DEFAULT_COLS,
): GridLayout {
    const others = occupiedLayouts
        .filter(l => l.i !== widget.i && l.i !== anchor?.i)
        .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

    for (let y = widget.y; y < MAX_SEARCH_ROWS; y++) {
        for (let x = 0; x <= cols - widget.w; x++) {
            const testLayout = { ...widget, x, y };
            const hasOverlap = others.some(layout => layoutsOverlap(testLayout, layout));
            if (!hasOverlap && (!anchor || !layoutsOverlap(testLayout, anchor))) {
                return testLayout;
            }
        }
    }

    const maxY = Math.max(...others.map(l => l.y + l.h), 0);
    return { ...widget, x: 0, y: maxY };
}

/**
 * Reflows the grid around a priority `anchor` item (a dragged or freshly-inserted widget):
 * the anchor keeps its position, and every other item overlapping it is moved to the next
 * free slot. This is the shared collision-resolution used both during drag and on insertion.
 */
export function reflowAroundAnchor(
    layouts: GridLayout[],
    anchor: GridLayout,
    cols: number = DEFAULT_COLS,
): GridLayout[] {
    const result = layouts.map(l => (l.i === anchor.i ? anchor : l));
    for (let i = 0; i < result.length; i++) {
        if (result[i].i !== anchor.i && layoutsOverlap(anchor, result[i])) {
            result[i] = findNextAvailablePosition(result[i], result, anchor, cols);
        }
    }
    return result;
}

/**
 * Inserts `item` at its desired position and reflows every overlapping widget out of the way,
 * so a re-added widget reclaims its saved space instead of overlapping or being dumped at the
 * next free slot. The returned array preserves input order with `item` appended.
 */
export function insertWithReflow(
    layouts: GridLayout[],
    item: GridLayout,
    cols: number = DEFAULT_COLS,
): GridLayout[] {
    return reflowAroundAnchor([...layouts, item], item, cols);
}

/**
 * Vertically compacts the layout: every widget floats up as far as it can without colliding
 * with a widget already placed above it, filling the space freed when a widget is removed.
 * Horizontal positions are preserved. The returned array preserves the input order.
 */
export function compactLayouts(layouts: GridLayout[]): GridLayout[] {
    const sorted = [...layouts].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
    const compacted: GridLayout[] = [];
    for (const item of sorted) {
        let moved = { ...item };
        while (moved.y > 0) {
            const test = { ...moved, y: moved.y - 1 };
            if (compacted.some(other => layoutsOverlap(test, other))) break;
            moved = test;
        }
        compacted.push(moved);
    }
    return layouts.map(l => compacted.find(c => c.i === l.i) ?? l);
}

/**
 * Grows already-placed widgets to fill the empty cells left by the packing, so rows are padded
 * out and holes are minimized. Each widget is expanded — first rightward, then downward — one
 * cell at a time as far as it can without overlapping another widget, staying within its own
 * `maxW`/`maxH` bounds (a widget with no bound may grow to the grid edge / bottom of the packed
 * area). Positions and the overall packed height are never changed, and widgets are never shrunk
 * below their input size, so the result is never worse-packed than the plain placement. Because
 * growth only ever adds cells (never moves a widget), this converges to a fixed point.
 */
function growToFill(placed: GridLayout[], cols: number): GridLayout[] {
    // Bounded by the packed height so tidying never makes the grid taller.
    const maxRow = Math.max(0, ...placed.map(l => l.y + l.h));
    const items = placed.map(l => ({ ...l }));
    const order = [...items].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
    let changed = true;
    while (changed) {
        changed = false;
        for (const item of order) {
            const others = items.filter(other => other.i !== item.i);
            const maxW = item.maxW ?? cols;
            while (
                item.w + 1 <= maxW &&
                item.x + item.w + 1 <= cols &&
                !others.some(other => layoutsOverlap({ ...item, w: item.w + 1 }, other))
            ) {
                item.w += 1;
                changed = true;
            }
            const maxH = item.maxH ?? Number.POSITIVE_INFINITY;
            while (
                item.h + 1 <= maxH &&
                item.y + item.h + 1 <= maxRow &&
                !others.some(other => layoutsOverlap({ ...item, h: item.h + 1 }, other))
            ) {
                item.h += 1;
                changed = true;
            }
        }
    }
    return items;
}

/**
 * Re-arranges every widget into the tightest gap-free arrangement. Widgets are first placed one
 * at a time in reading order (top-to-bottom, then left-to-right), each at the topmost-then-
 * leftmost slot where it fits without overlapping an already-placed widget. Widgets are then
 * grown within their own `maxW`/`maxH` bounds to fill the leftover gaps, so the
 * packed area ends up as full as possible. The result is deterministic, has no overlaps, respects
 * every widget's size bounds strictly, is never worse-packed (nor taller) than the input, and is
 * idempotent — tidying an already-tidy layout is a no-op. The returned array preserves the input
 * order.
 */
export function tidyLayouts(layouts: GridLayout[], cols: number = DEFAULT_COLS): GridLayout[] {
    const ordered = [...layouts].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
    const placed: GridLayout[] = [];
    for (const item of ordered) {
        // Scanning from y=0 finds the globally topmost-leftmost free slot, for stronger compaction.
        placed.push(findNextAvailablePosition({ ...item, x: 0, y: 0 }, placed, undefined, cols));
    }
    const grown = growToFill(placed, cols);
    return layouts.map(l => grown.find(p => p.i === l.i) ?? l);
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

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
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
        },
        [isDraggable, isResizing, layout.x, layout.y, onInteractionStart],
    );

    const handleResizeStart = useCallback(
        (e: React.MouseEvent) => {
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
        },
        [isResizable, layout.w, layout.h, onInteractionStart],
    );

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
                const maxW = layout.maxW ?? cols - layout.x;
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
                'transition-shadow',
                isDraggable && !isResizing && 'cursor-move',
                (isDragging || isResizing) && 'shadow-lg',
            )}
            onMouseDown={handleMouseDown}
        >
            <div className="h-full w-full">{children}</div>
            {isResizable && (
                <div
                    className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize bg-muted-foreground/20 hover:bg-muted-foreground/40 transition-colors"
                    style={{
                        clipPath: 'polygon(100% 0%, 0% 100%, 100% 100%)',
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

    const handleItemLayoutChange = useCallback(
        (newLayout: GridLayout) => {
            if (onLayoutChange && !isMobile) {
                // Disable layout changes on mobile
                if (!layouts.some(l => l.i === newLayout.i)) return;
                onLayoutChange(reflowAroundAnchor(layouts, newLayout, cols));
            }
        },
        [layouts, onLayoutChange, cols, isMobile],
    );

    const handleInteractionStart = useCallback(() => {
        setShowGrid(true);
    }, []);

    const handleInteractionEnd = useCallback(() => {
        setShowGrid(false);
    }, []);

    // Create the edit-mode grid: one set of cells matching the exact cell geometry
    // (including gutters) used to position widgets. Shown faintly while editing as
    // an alignment aid, and highlighted while dragging/resizing.
    const isEditing = isDraggable || isResizable;
    const renderGridOverlay = () => {
        if (!isEditing) return null;

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
                        className={cn(
                            'transition-colors duration-200 border-dashed rounded-sm',
                            showGrid ? 'border-2 border-primary bg-primary/10' : 'border border-border',
                        )}
                    />,
                );
            }
        }

        return gridCells;
    };

    return (
        <div
            className={cn('relative w-full bg-muted/10', className)}
            style={{
                height: `${containerHeight}px`,
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
