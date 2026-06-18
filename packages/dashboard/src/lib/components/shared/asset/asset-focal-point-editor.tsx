import { Button } from '@/vdb/components/ui/button.js';
import { Trans } from '@lingui/react/macro';
import { cn } from '@/vdb/lib/utils.js';
import { DndContext, useDraggable } from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { Crosshair, X } from 'lucide-react';
import { useState } from 'react';

export interface AssetFocalPointEditorProps {
    settingFocalPoint: boolean;
    focalPoint: Point | undefined;
    width: number;
    height: number;
    onFocalPointChange: (point: Point) => void;
    onCancel: () => void;
    children?: React.ReactNode;
}

export interface Point {
    x: number;
    y: number;
}

function DraggableFocalPoint({ point }: { point: Point }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: 'focal-point',
    });
    const style = {
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
        transform: isDragging
            ? `translate(-50%, -50%) ${CSS.Translate.toString(transform)}`
            : `translate(-50%, -50%)`,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            className="absolute w-8 h-8 rounded-full border-4 border-white bg-brand/20 shadow-lg cursor-move"
        />
    );
}

export function AssetFocalPointEditor({
    settingFocalPoint,
    focalPoint,
    width,
    height,
    onFocalPointChange,
    onCancel,
    children,
}: AssetFocalPointEditorProps) {
    const [focalPointCurrent, setFocalPointCurrent] = useState<Point>(focalPoint ?? { x: 0.5, y: 0.5 });

    const handleDragEnd = (event: any) => {
        const { delta } = event;
        const newX = Math.max(0, Math.min(1, focalPointCurrent.x + delta.x / width));
        const newY = Math.max(0, Math.min(1, focalPointCurrent.y + delta.y / height));
        const newPoint = { x: newX, y: newY };
        setFocalPointCurrent(newPoint);
    };

    return (
        <div
            className={cn(
                'relative',
                'flex items-center justify-center',
                settingFocalPoint && 'cursor-crosshair',
            )}
        >
            <div className="relative" style={{ width: `${width}px`, height: `${height}px` }}>
                {children}
                {settingFocalPoint && (
                    <DndContext onDragEnd={handleDragEnd} modifiers={[restrictToParentElement]}>
                        <DraggableFocalPoint point={focalPointCurrent} />
                    </DndContext>
                )}
            </div>

            {settingFocalPoint && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                    <Button type="button" variant="secondary" onClick={onCancel}>
                        <X className="mr-2 h-4 w-4" />
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button
                        type="button"
                        onClick={() => {
                            onFocalPointChange(focalPointCurrent);
                        }}
                    >
                        <Crosshair className="mr-2 h-4 w-4" />
                        <Trans>Set Focal Point</Trans>
                    </Button>
                </div>
            )}
        </div>
    );
}
