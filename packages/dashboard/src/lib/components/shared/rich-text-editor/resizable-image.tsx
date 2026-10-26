import { useLingui } from '@lingui/react/macro';
import Image from '@tiptap/extension-image';
import { NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';

const MIN_WIDTH = 40;
const KEYBOARD_RESIZE_STEP = 10;

function ImageNodeView({ node, updateAttributes, selected, editor }: NodeViewProps) {
    const { t } = useLingui();
    const imgRef = useRef<HTMLImageElement>(null);
    const [dragWidth, setDragWidth] = useState<number | null>(null);
    const pointerCleanupRef = useRef<(() => void) | null>(null);

    const widthBounds = () => ({
        current: imgRef.current?.offsetWidth ?? MIN_WIDTH,
        max: imgRef.current?.closest('.rich-text-editor')?.clientWidth ?? Infinity,
    });

    const clampWidth = (width: number, maxWidth: number) => Math.min(Math.max(width, MIN_WIDTH), maxWidth);

    const startResize = (event: React.PointerEvent<HTMLButtonElement>, direction: 1 | -1) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const { current: startWidth, max: maxWidth } = widthBounds();
        let width = startWidth;

        const onPointerMove = (moveEvent: PointerEvent) => {
            width = clampWidth(startWidth + direction * (moveEvent.clientX - startX), maxWidth);
            setDragWidth(width);
        };
        const finishResize = () => {
            pointerCleanupRef.current?.();
            setDragWidth(null);
            // Clear the height so the image keeps its aspect ratio
            updateAttributes({ width: Math.round(width), height: null });
        };
        const cleanup = () => {
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', finishResize);
            document.removeEventListener('pointercancel', finishResize);
            pointerCleanupRef.current = null;
        };
        pointerCleanupRef.current?.();
        pointerCleanupRef.current = cleanup;
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', finishResize);
        document.addEventListener('pointercancel', finishResize);
    };

    const resizeWithKeyboard = (event: React.KeyboardEvent, direction: 1 | -1) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const { current, max } = widthBounds();
        const arrowDirection = event.key === 'ArrowRight' ? 1 : -1;
        const step = event.shiftKey ? KEYBOARD_RESIZE_STEP * 5 : KEYBOARD_RESIZE_STEP;
        updateAttributes({
            width: Math.round(clampWidth(current + direction * arrowDirection * step, max)),
            height: null,
        });
    };

    useEffect(() => () => pointerCleanupRef.current?.(), []);

    const width = dragWidth ?? (node.attrs.width as number | null);
    const showHandles = selected && editor.isEditable;

    return (
        <NodeViewWrapper as="span" className="relative inline-block leading-none" data-drag-handle>
            <img
                ref={imgRef}
                src={node.attrs.src}
                alt={node.attrs.alt ?? ''}
                title={node.attrs.title ?? undefined}
                className={`rich-text-image ${selected ? 'ProseMirror-selectednode' : ''}`}
                style={{
                    width: width ? `${width}px` : undefined,
                    height: dragWidth ? 'auto' : undefined,
                }}
                height={dragWidth ? undefined : (node.attrs.height ?? undefined)}
            />
            {showHandles && (
                <>
                    <button
                        type="button"
                        aria-label={t`Resize image from left`}
                        onPointerDown={e => startResize(e, -1)}
                        onKeyDown={e => resizeWithKeyboard(e, -1)}
                        className="absolute top-1/2 -left-1 h-6 w-2 -translate-y-1/2 touch-none cursor-ew-resize rounded-full border border-background bg-primary"
                    />
                    <button
                        type="button"
                        aria-label={t`Resize image from right`}
                        onPointerDown={e => startResize(e, 1)}
                        onKeyDown={e => resizeWithKeyboard(e, 1)}
                        className="absolute top-1/2 -right-1 h-6 w-2 -translate-y-1/2 touch-none cursor-ew-resize rounded-full border border-background bg-primary"
                    />
                </>
            )}
        </NodeViewWrapper>
    );
}

/**
 * The default Image extension with a custom node view that adds
 * drag-to-resize handles when the image is selected.
 */
export const ResizableImage = Image.extend({
    addNodeView() {
        return ReactNodeViewRenderer(ImageNodeView);
    },
});
