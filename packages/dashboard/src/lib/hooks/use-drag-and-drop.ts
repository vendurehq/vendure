import { DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useCallback, useMemo, useState } from 'react';

interface UseDragAndDropOptions<TData> {
    data: TData[];
    onReorder?: (oldIndex: number, newIndex: number, item: TData, allItems?: TData[]) => void | Promise<void>;
    onError?: (error: Error) => void;
    disabled?: boolean;
}

/**
 * @description
 * Provides the sensors and state management for drag and drop functionality.
 *
 *
 * @docsCategory hooks
 * @docsPage useDragAndDrop
 * @docsWeight 0
 * @since 3.3.0
 */
export function useDragAndDrop<TData = any>(options: UseDragAndDropOptions<TData>) {
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        }),
    );

    const { data, onReorder, onError, disabled = false } = options;

    // The order of a drop, kept while `onReorder` runs and until `data` changes.
    // Otherwise the rows are `data` itself, read during render: a copy made in an
    // effect is one render behind, so the render where a query finishes would
    // show no rows (the empty state) with `isLoading` already false.
    const [dropped, setDropped] = useState<{ source: TData[]; rows: TData[] } | null>(null);
    const [isReordering, setIsReordering] = useState(false);
    if (dropped && !isReordering && dropped.source !== data) {
        setDropped(null);
    }
    const localData = dropped?.rows ?? data;

    const handleDragEnd = useCallback(
        async (event: DragEndEvent) => {
            const { active, over } = event;

            // One drop at a time: a second one would end the first one's hold, and
            // its indices would come from rows the first one is still changing.
            if (!over || active.id === over.id || !onReorder || disabled || isReordering) {
                return;
            }

            const oldIndex = localData.findIndex(item => (item as { id: string }).id === active.id);
            const newIndex = localData.findIndex(item => (item as { id: string }).id === over.id);

            if (oldIndex === -1 || newIndex === -1) {
                return;
            }

            setDropped({ source: data, rows: arrayMove(localData, oldIndex, newIndex) });
            setIsReordering(true);

            try {
                await onReorder(oldIndex, newIndex, localData[oldIndex], localData);
            } catch (error) {
                setDropped(null);
                onError?.(error as Error);
            } finally {
                setIsReordering(false);
            }
        },
        [data, localData, onReorder, onError, disabled, isReordering],
    );

    const itemIds = useMemo(() => localData.map(item => (item as { id: string }).id), [localData]);

    return {
        sensors,
        localData,
        handleDragEnd,
        itemIds,
        isReordering,
    };
}
