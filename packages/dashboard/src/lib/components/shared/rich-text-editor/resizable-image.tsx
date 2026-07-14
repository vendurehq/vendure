import Image from '@tiptap/extension-image';
import { NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useRef, useState } from 'react';

const MIN_WIDTH = 40;

function ImageNodeView({ node, updateAttributes, selected, editor }: NodeViewProps) {
    const imgRef = useRef<HTMLImageElement>(null);
    const [dragWidth, setDragWidth] = useState<number | null>(null);

    const startResize = (event: React.MouseEvent, direction: 1 | -1) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = imgRef.current?.offsetWidth ?? 0;
        const maxWidth = imgRef.current?.closest('.rich-text-editor')?.clientWidth ?? Infinity;
        let width = startWidth;

        const onMouseMove = (moveEvent: MouseEvent) => {
            width = Math.min(Math.max(startWidth + direction * (moveEvent.clientX - startX), MIN_WIDTH), maxWidth);
            setDragWidth(width);
        };
        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            setDragWidth(null);
            // Clear the height so the image keeps its aspect ratio
            updateAttributes({ width: Math.round(width), height: null });
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

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
                    <span
                        role="presentation"
                        onMouseDown={e => startResize(e, -1)}
                        className="absolute top-1/2 -left-1 h-6 w-2 -translate-y-1/2 cursor-ew-resize rounded-full border border-background bg-primary"
                    />
                    <span
                        role="presentation"
                        onMouseDown={e => startResize(e, 1)}
                        className="absolute top-1/2 -right-1 h-6 w-2 -translate-y-1/2 cursor-ew-resize rounded-full border border-background bg-primary"
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
