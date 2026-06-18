import { DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useCallback, useEffect, useMemo, useState } from 'react';

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

    const { data, onReorder, disabled = false } = options;

    const [localData, setLocalData] = useState<TData[]>(data);
    const [isReordering, setIsReordering] = useState(false);

    // Update local data when data prop changes (but not during reordering)
    useEffect(() => {
        if (!isReordering) {
            setLocalData(data);
        }
    }, [data, isReordering]);

    const handleDragEnd = useCallback(
        async (event: DragEndEvent) => {
            const { active, over } = event;

            if (!over || active.id === over.id || !onReorder || disabled) {
                return;
            }

            const oldIndex = localData.findIndex(item => (item as { id: string }).id === active.id);
            const newIndex = localData.findIndex(item => (item as { id: string }).id === over.id);

            if (oldIndex === -1 || newIndex === -1) {
                return;
            }

            // Optimistically update the UI
            const originalState = [...localData];
            const newData = arrayMove(localData, oldIndex, newIndex);
            setLocalData(newData);
            setIsReordering(true);

            try {
                // Call the user's onReorder callback with all items for context
                await onReorder(oldIndex, newIndex, localData[oldIndex], localData);
            } catch (error) {
                // Revert on error
                setLocalData(originalState);
                options.onError?.(error as Error);
            } finally {
                setIsReordering(false);
            }
        },
        [localData, onReorder, disabled],
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
