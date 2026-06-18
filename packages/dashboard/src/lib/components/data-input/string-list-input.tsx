import { GripVertical, X } from 'lucide-react';
import { KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import { Badge } from '@/vdb/components/ui/badge.js';
import { Input } from '@/vdb/components/ui/input.js';
import type { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isReadonlyField } from '@/vdb/framework/form-engine/utils.js';
import { cn } from '@/vdb/lib/utils.js';
import {
    closestCenter,
    DndContext,
    type DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLingui } from '@lingui/react';

interface SortableItemProps {
    id: string;
    item: string;
    isDisabled: boolean;
    isEditing: boolean;
    onRemove: () => void;
    onEdit: () => void;
    onSave: (newValue: string) => void;
}

function SortableItem({ id, item, isDisabled, isEditing, onRemove, onEdit, onSave }: SortableItemProps) {
    const [editValue, setEditValue] = useState(item);
    const inputRef = useRef<HTMLInputElement>(null);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    const handleSave = () => {
        const trimmedValue = editValue.trim();
        if (trimmedValue && trimmedValue !== item) {
            onSave(trimmedValue);
        } else {
            setEditValue(item);
            onSave(item);
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') {
            setEditValue(item);
            onSave(item);
        }
    };

    // Focus and select input when entering edit mode
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    useEffect(() => {
        if (item !== editValue) {
            setEditValue(item);
        }
    }, [item]);

    return (
        <Badge
            ref={setNodeRef}
            style={style}
            variant="secondary"
            className={cn(
                isDragging && 'opacity-50',
                'flex items-center gap-1',
                isEditing && 'border-muted-foreground/30',
            )}
        >
            {!isDisabled && (
                <button
                    type="button"
                    className={cn(
                        'cursor-grab active:cursor-grabbing text-muted-foreground',
                        'hover:bg-muted rounded p-0.5',
                    )}
                    {...attributes}
                    {...listeners}
                    aria-label={`Drag ${item}`}
                >
                    <GripVertical className="h-3 w-3" />
                </button>
            )}
            {isEditing ? (
                <input
                    ref={inputRef}
                    type="text"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSave}
                    className="bg-transparent border-none outline-none focus:ring-0 p-0 h-auto min-w-[60px] w-auto"
                    style={{ width: `${Math.max(editValue.length * 8, 60)}px` }}
                />
            ) : (
                <button
                    type="button"
                    onClick={!isDisabled ? onEdit : undefined}
                    className={cn(!isDisabled && 'cursor-text hover:underline')}
                >
                    {item}
                </button>
            )}
            {!isDisabled && (
                <button
                    type="button"
                    onClick={e => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    className={cn(
                        'ml-1 rounded-full outline-none ring-offset-background text-muted-foreground',
                        'hover:bg-muted focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    )}
                    aria-label={`Remove ${item}`}
                >
                    <X className="h-3 w-3" />
                </button>
            )}
        </Badge>
    );
}

export function StringListInput({
    value,
    onChange,
    onBlur,
    disabled,
    name,
    fieldDef,
}: DashboardFormComponentProps) {
    const [inputValue, setInputValue] = useState('');
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const { i18n } = useLingui();
    const isDisabled = isReadonlyField(fieldDef) || disabled || false;
    const id = useId();

    const items = Array.isArray(value) ? value : [];

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        }),
    );

    const addItem = (item: string) => {
        const trimmedItem = item.trim();
        if (trimmedItem) {
            onChange([...items, trimmedItem]);
            setInputValue('');
        }
    };

    const removeItem = (indexToRemove: number) => {
        onChange(items.filter((_, index) => index !== indexToRemove));
    };

    const editItem = (index: number, newValue: string) => {
        const newItems = [...items];
        newItems[index] = newValue;
        onChange(newItems);
        setEditingIndex(null);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = items.findIndex((_, idx) => `${id}-${idx}` === active.id);
            const newIndex = items.findIndex((_, idx) => `${id}-${idx}` === over.id);

            onChange(arrayMove(items, oldIndex, newIndex));
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addItem(inputValue);
        } else if (e.key === 'Backspace' && !inputValue && items.length > 0) {
            // Remove last item when backspace is pressed on empty input
            removeItem(items.length - 1);
        }
    };

    const handleInputBlur = () => {
        // Add current input value as item on blur if there's any
        if (inputValue.trim()) {
            addItem(inputValue);
        }
        onBlur?.();
    };

    return (
        <div
            className={cn(
                'flex min-h-10 w-full flex-wrap gap-2',
                isDisabled && 'cursor-not-allowed opacity-50',
            )}
        >
            {!isDisabled && (
                <Input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleInputBlur}
                    name={name}
                    placeholder={i18n.t('Type and press Enter or comma to add...')}
                    className="min-w-[120px]"
                />
            )}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                    items={items.map((_, index) => `${id}-${index}`)}
                    strategy={verticalListSortingStrategy}
                >
                    <div className="flex flex-wrap gap-1 items-start justify-start">
                        {items.map((item, index) => (
                            <SortableItem
                                key={`${id}-${index}`}
                                id={`${id}-${index}`}
                                item={item}
                                isDisabled={isDisabled}
                                isEditing={editingIndex === index}
                                onRemove={() => removeItem(index)}
                                onEdit={() => setEditingIndex(index)}
                                onSave={newValue => editItem(index, newValue)}
                            />
                        ))}
                    </div>
                </SortableContext>
            </DndContext>
        </div>
    );
}

StringListInput.metadata = {
    isListInput: true,
};
