import { AccessorFnColumnDef, ExpandedState } from '@tanstack/react-table';
import { AccessorKeyColumnDef } from '@tanstack/table-core';

/**
 * Returns the default column visibility configuration.
 *
 * @example
 * ```ts
 * const columnVisibility = getColumnVisibility(fields, {
 *     id: false,
 *     createdAt: false,
 *     updatedAt: false,
 * });
 * ```
 */
export function getColumnVisibility(
    columns: Array<AccessorKeyColumnDef<any> | AccessorFnColumnDef<any>>,
    defaultVisibility?: Record<string, boolean | undefined>,
    customFieldColumnNames?: string[],
): Record<string, boolean> {
    const allDefaultsTrue = defaultVisibility && Object.values(defaultVisibility).every(v => v === true);
    const allDefaultsFalse = defaultVisibility && Object.values(defaultVisibility).every(v => v === false);
    return {
        id: false,
        createdAt: false,
        updatedAt: false,
        ...(allDefaultsTrue ? { ...Object.fromEntries(columns.map(f => [f.id, false])) } : {}),
        ...(allDefaultsFalse ? { ...Object.fromEntries(columns.map(f => [f.id, true])) } : {}),
        // Make custom fields hidden by default unless overridden
        ...(customFieldColumnNames
            ? { ...Object.fromEntries(customFieldColumnNames.map(f => [f, false])) }
            : {}),
        ...defaultVisibility,
        selection: true,
        actions: true,
    };
}

/**
 * Ensures that the default column order always starts with `id`, `createdAt`, `deletedAt`
 */
export function getStandardizedDefaultColumnOrder<T extends string | number | symbol>(
    defaultColumnOrder?: T[],
): T[] {
    const standardFirstColumns = new Set(['id', 'createdAt', 'updatedAt']);
    if (!defaultColumnOrder) {
        return [...standardFirstColumns] as T[];
    }
    const rest = defaultColumnOrder.filter(c => !standardFirstColumns.has(c as string));
    return [...standardFirstColumns, ...rest] as T[];
}

/**
 * Hierarchical item type with parent-child relationships
 */
export interface HierarchicalItem {
    id: string;
    parentId?: string | null;
    breadcrumbs?: Array<{ id: string }>;
    children?: Array<{ id: string }> | null;
}

/**
 * Gets the parent ID of a hierarchical item
 */
export function getItemParentId<T extends HierarchicalItem>(
    item: T | null | undefined,
): string | null | undefined {
    return item?.parentId || item?.breadcrumbs?.[0]?.id;
}

/**
 * Gets all siblings (items with the same parent) for a given parent ID
 */
export function getItemSiblings<T extends HierarchicalItem>(
    items: T[],
    parentId: string | null | undefined,
): T[] {
    return items.filter(item => getItemParentId(item) === parentId);
}

/**
 * Checks if moving an item to a new parent would create a circular reference
 */
export function isCircularReference<T extends HierarchicalItem>(
    item: T,
    targetParentId: string,
    items: T[],
): boolean {
    const targetParentItem = items.find(i => i.id === targetParentId);
    return (
        item.children?.some(child => {
            if (child.id === targetParentId) return true;
            const targetBreadcrumbIds = targetParentItem?.breadcrumbs?.map(b => b.id) || [];
            return targetBreadcrumbIds.includes(item.id);
        }) ?? false
    );
}

/**
 * Result of calculating the target position for a drag and drop operation
 */
export interface TargetPosition {
    targetParentId: string;
    adjustedIndex: number;
}

/**
 * Context for drag and drop position calculation
 */
interface DragContext<T extends HierarchicalItem> {
    item: T;
    targetItem: T | undefined;
    previousItem: T | null;
    isDraggingDown: boolean;
    isTargetExpanded: boolean;
    isPreviousExpanded: boolean;
    sourceParentId: string;
    items: T[];
}

/**
 * Checks if dragging down directly onto an expanded item
 */
function isDroppingIntoExpandedTarget<T extends HierarchicalItem>(context: DragContext<T>): boolean {
    const { isDraggingDown, targetItem, item, isTargetExpanded } = context;
    return isDraggingDown && targetItem?.id !== item.id && isTargetExpanded;
}

/**
 * Checks if dragging up into an expanded item's children area
 */
function isDroppingIntoExpandedPreviousWhenDraggingUp<T extends HierarchicalItem>(
    context: DragContext<T>,
): boolean {
    const { isDraggingDown, previousItem, isPreviousExpanded } = context;
    return !isDraggingDown && previousItem !== null && isPreviousExpanded;
}

/**
 * Checks if an item is in an expanded state
 */
function isItemExpanded(itemId: string | undefined, expanded: ExpandedState): boolean {
    if (!itemId) return false;
    return expanded === true || (typeof expanded === 'object' && !!expanded[itemId]);
}

/**
 * Handles dropping into expanded items (first child position)
 */
function handleExpandedItemDrop<T extends HierarchicalItem>(context: DragContext<T>): TargetPosition | null {
    const { targetItem, previousItem } = context;

    if (isDroppingIntoExpandedTarget(context) && targetItem) {
        return createFirstChildPosition(targetItem.id);
    }

    if (previousItem && isDroppingIntoExpandedPreviousWhenDraggingUp(context)) {
        return createFirstChildPosition(previousItem.id);
    }

    return null;
}

/**
 * Creates a position for dropping into an expanded item as first child
 */
function createFirstChildPosition(parentId: string): TargetPosition {
    return { targetParentId: parentId, adjustedIndex: 0 };
}

/**
 * Calculates position for cross-parent drag operations
 */
function calculateCrossParentPosition<T extends HierarchicalItem>(
    targetItem: T,
    sourceParentId: string,
    items: T[],
    isDraggingDown: boolean,
): TargetPosition | null {
    const targetItemParentId = getItemParentId(targetItem);

    if (!targetItemParentId || targetItemParentId === sourceParentId) {
        return null;
    }

    const visibleSiblings = getItemSiblings(items, targetItemParentId);
    const targetIndex = visibleSiblings.findIndex(i => i.id === targetItem.id);
    const isLastVisible = targetIndex === visibleSiblings.length - 1;

    if (isDraggingDown && isLastVisible) {
        // Dropping after the last visible sibling — use the parent's children
        // count to ensure we always land at the actual end, even if the
        // dashboard has stale or paginated data.
        const parentItem = items.find(i => i.id === targetItemParentId);
        const totalChildren = parentItem?.children?.length ?? visibleSiblings.length;
        return { targetParentId: targetItemParentId, adjustedIndex: totalChildren };
    }

    const adjustedIndex = isDraggingDown ? targetIndex + 1 : targetIndex;
    return { targetParentId: targetItemParentId, adjustedIndex };
}

/**
 * Calculates position when dropping at the end of the list
 */
function calculateDropAtEndPosition<T extends HierarchicalItem>(
    previousItem: T | null,
    sourceParentId: string,
    items: T[],
): TargetPosition | null {
    if (!previousItem) {
        return null;
    }

    const previousItemParentId = getItemParentId(previousItem);

    if (!previousItemParentId || previousItemParentId === sourceParentId) {
        return null;
    }

    const parentItem = items.find(i => i.id === previousItemParentId);
    const totalChildren = parentItem?.children?.length ?? getItemSiblings(items, previousItemParentId).length;
    return { targetParentId: previousItemParentId, adjustedIndex: totalChildren };
}

/**
 * Determines the target parent and index for a hierarchical drag and drop operation
 */
export function calculateDragTargetPosition<T extends HierarchicalItem>(params: {
    item: T;
    oldIndex: number;
    newIndex: number;
    items: T[];
    sourceParentId: string;
    expanded: ExpandedState;
}): TargetPosition {
    const { item, oldIndex, newIndex, items, sourceParentId, expanded } = params;

    const targetItem = items[newIndex];
    const previousItem = newIndex > 0 ? items[newIndex - 1] : null;

    const context: DragContext<T> = {
        item,
        targetItem,
        previousItem,
        isDraggingDown: oldIndex < newIndex,
        isTargetExpanded: isItemExpanded(targetItem?.id, expanded),
        isPreviousExpanded: isItemExpanded(previousItem?.id, expanded),
        sourceParentId,
        items,
    };

    // Handle dropping into expanded items (becomes first child)
    const expandedDropPosition = handleExpandedItemDrop(context);
    if (expandedDropPosition) {
        return expandedDropPosition;
    }

    // Handle cross-parent drag operations
    if (targetItem?.id !== item.id) {
        const crossParentPosition = calculateCrossParentPosition(
            targetItem,
            sourceParentId,
            items,
            context.isDraggingDown,
        );
        if (crossParentPosition) {
            return crossParentPosition;
        }
    }

    // Handle dropping at the end of the list
    if (!targetItem && previousItem) {
        const dropAtEndPosition = calculateDropAtEndPosition(previousItem, sourceParentId, items);
        if (dropAtEndPosition) {
            return dropAtEndPosition;
        }
    }

    // Default: stay in the same parent at the beginning
    return { targetParentId: sourceParentId, adjustedIndex: 0 };
}

/**
 * Calculates the adjusted sibling index when reordering within the same parent
 */
export function calculateSiblingIndex<T extends HierarchicalItem>(params: {
    item: T;
    oldIndex: number;
    newIndex: number;
    items: T[];
    parentId: string;
}): number {
    const { item, oldIndex, newIndex, items, parentId } = params;

    const siblings = getItemSiblings(items, parentId);
    const oldSiblingIndex = siblings.findIndex(i => i.id === item.id);
    const isDraggingDown = oldIndex < newIndex;

    let newSiblingIndex = oldSiblingIndex;
    const [start, end] = isDraggingDown ? [oldIndex + 1, newIndex] : [newIndex, oldIndex - 1];

    for (let i = start; i <= end; i++) {
        if (getItemParentId(items[i]) === parentId) {
            newSiblingIndex += isDraggingDown ? 1 : -1;
        }
    }

    return newSiblingIndex;
}
