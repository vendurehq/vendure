import { Button } from '@/vdb/components/ui/button.js';
import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import {
    closestCenter,
    DndContext,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLingui } from '@lingui/react/macro';
import { GripVertical, Plus, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ControllerRenderProps } from 'react-hook-form';

interface ListItemWithId {
    _id: string;
    value: any;
}

interface CustomFieldListInputProps extends DashboardFormComponentProps {
    renderInput: (index: number, inputField: ControllerRenderProps<any, any>) => React.ReactNode;
    defaultValue?: any;
}

interface SortableItemProps {
    itemWithId: ListItemWithId;
    index: number;
    disabled?: boolean;
    renderInput: (index: number, inputField: ControllerRenderProps<any, any>) => React.ReactNode;
    onRemove: (id: string) => void;
    onItemChange: (id: string, value: any) => void;
    field: ControllerRenderProps<any, any>;
    isFullWidth?: boolean;
}

function SortableItem({
    itemWithId,
    index,
    disabled,
    renderInput,
    onRemove,
    onItemChange,
    field,
    isFullWidth = false,
}: Readonly<SortableItemProps>) {
    const { t } = useLingui();
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: itemWithId._id,
        disabled,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    const DragHandle = !disabled && (
        <div
            {...attributes}
            {...listeners}
            className="cursor-move text-muted-foreground hover:text-foreground transition-colors"
            title={t`Drag to reorder`}
        >
            <GripVertical className="h-4 w-4" />
        </div>
    );

    const RemoveButton = !disabled && (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRemove(itemWithId._id)}
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
            title={t`Remove item`}
        >
            <X className="h-3 w-3" />
        </Button>
    );

    if (!isFullWidth) {
        // Inline layout for single-line inputs
        return (
            <div
                ref={setNodeRef}
                style={style}
                className={`group relative flex items-center gap-2 p-2 border rounded-lg bg-card hover:bg-accent/50 transition-colors ${
                    isDragging ? 'opacity-50 shadow-lg' : ''
                }`}
            >
                {DragHandle}
                <div className="flex-1">
                    {renderInput(index, {
                        name: `${field.name}.${index}`,
                        value: itemWithId.value,
                        onChange: value => onItemChange(itemWithId._id, value),
                        onBlur: field.onBlur,
                        ref: field.ref,
                    } as ControllerRenderProps<any, any>)}
                </div>
                {RemoveButton}
            </div>
        );
    }

    // Full-width layout for complex inputs
    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`group relative border rounded-lg bg-card hover:bg-accent/50 transition-colors ${
                isDragging ? 'opacity-50 shadow-lg' : ''
            }`}
        >
            <div className="flex items-center justify-between px-3 py-2 border-b">
                {DragHandle}
                <div className="flex-1" />
                {RemoveButton}
            </div>
            <div className="p-3">
                {renderInput(index, {
                    name: `${field.name}.${index}`,
                    value: itemWithId.value,
                    onChange: value => onItemChange(itemWithId._id, value),
                    onBlur: field.onBlur,
                    ref: field.ref,
                } as ControllerRenderProps<any, any>)}
            </div>
        </div>
    );
}

// Generate unique IDs for list items
function generateId(): string {
    return `item-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Convert flat array to array with stable IDs
function convertToItemsWithIds(values: any[], existingItems?: ListItemWithId[]): ListItemWithId[] {
    if (!values || !Array.isArray(values) || values.length === 0) return [];

    return values.map((value, index) => {
        // Try to reuse existing ID if the value matches and index is within bounds
        const existingItem = existingItems?.[index];
        if (existingItem && JSON.stringify(existingItem.value) === JSON.stringify(value)) {
            return existingItem;
        }

        // Otherwise create new item with new ID
        return {
            _id: generateId(),
            value,
        };
    });
}

// Convert array with IDs back to flat array
function convertToFlatArray(itemsWithIds: ListItemWithId[]): any[] {
    return itemsWithIds.map(item => item.value);
}

export const CustomFieldListInput = ({
    renderInput,
    defaultValue,
    ...fieldProps
}: CustomFieldListInputProps) => {
    const { value, onChange, disabled } = fieldProps;
    const { t } = useLingui();
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        }),
    );

    // Keep track of items with stable IDs
    const [itemsWithIds, setItemsWithIds] = useState<ListItemWithId[]>(() =>
        convertToItemsWithIds(value || []),
    );

    // Update items when field value changes externally (e.g., form reset, initial load)
    useEffect(() => {
        const newItems = convertToItemsWithIds(value || [], itemsWithIds);
        if (
            JSON.stringify(convertToFlatArray(newItems)) !== JSON.stringify(convertToFlatArray(itemsWithIds))
        ) {
            setItemsWithIds(newItems);
        }
    }, [value, itemsWithIds]);

    const itemIds = useMemo(() => itemsWithIds.map(item => item._id), [itemsWithIds]);

    const handleAddItem = useCallback(() => {
        const newItem: ListItemWithId = {
            _id: generateId(),
            value: defaultValue ?? '',
        };
        const newItemsWithIds = [...itemsWithIds, newItem];
        setItemsWithIds(newItemsWithIds);
        onChange(convertToFlatArray(newItemsWithIds));
    }, [itemsWithIds, defaultValue, onChange]);

    const handleRemoveItem = useCallback(
        (id: string) => {
            const newItemsWithIds = itemsWithIds.filter(item => item._id !== id);
            setItemsWithIds(newItemsWithIds);
            onChange(convertToFlatArray(newItemsWithIds));
        },
        [itemsWithIds, onChange],
    );

    const handleItemChange = useCallback(
        (id: string, value: any) => {
            const newItemsWithIds = itemsWithIds.map(item => (item._id === id ? { ...item, value } : item));
            setItemsWithIds(newItemsWithIds);
            onChange(convertToFlatArray(newItemsWithIds));
        },
        [itemsWithIds, onChange],
    );

    const handleDragEnd = useCallback(
        (event: any) => {
            const { active, over } = event;

            if (over && active.id !== over.id) {
                const oldIndex = itemIds.indexOf(active.id);
                const newIndex = itemIds.indexOf(over.id);

                const newItemsWithIds = arrayMove(itemsWithIds, oldIndex, newIndex);
                setItemsWithIds(newItemsWithIds);
                onChange(convertToFlatArray(newItemsWithIds));
            }
        },
        [itemIds, itemsWithIds, onChange],
    );

    const containerClasses = useMemo(() => {
        const contentClasses =
            'overflow-y-auto resize-y border-b rounded bg-muted/30 bg-background p-1 space-y-1';

        if (itemsWithIds.length === 0) {
            return `hidden`;
        } else if (itemsWithIds.length > 5) {
            return `h-[200px] ${contentClasses}`;
        } else {
            return `min-h-[100px] ${contentClasses}`;
        }
    }, [itemsWithIds.length]);

    return (
        <div className="space-y-2">
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
                modifiers={[restrictToVerticalAxis]}
            >
                <div className={containerClasses}>
                    <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                        {itemsWithIds.map((itemWithId, index) => (
                            <SortableItem
                                key={itemWithId._id}
                                itemWithId={itemWithId}
                                index={index}
                                disabled={disabled}
                                renderInput={renderInput}
                                onRemove={handleRemoveItem}
                                onItemChange={handleItemChange}
                                field={fieldProps}
                            />
                        ))}
                    </SortableContext>
                </div>
            </DndContext>

            {!disabled && (
                <Button type="button" variant="outline" size="sm" onClick={handleAddItem} className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    {t`Add item`}
                </Button>
            )}
        </div>
    );
};
