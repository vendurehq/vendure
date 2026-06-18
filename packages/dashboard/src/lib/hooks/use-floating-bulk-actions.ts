import { useEffect, useState } from 'react';

interface FloatingPosition {
    bottom: string;
    left: string;
}

interface UseFloatingBulkActionsOptions {
    selectionCount: number;
    containerSelector: string;
    bufferDistance?: number;
    bottomOffset?: number;
}

/**
 * Common logic used to power floating the bulk action component used in
 * data tables and in the asset gallery.
 */
export function useFloatingBulkActions({
    selectionCount,
    containerSelector,
    bufferDistance = 80,
    bottomOffset = 10,
}: Readonly<UseFloatingBulkActionsOptions>) {
    const [position, setPosition] = useState<FloatingPosition>({ bottom: '2.5rem', left: '50%' });
    const [isPositioned, setIsPositioned] = useState(false);

    useEffect(() => {
        if (selectionCount === 0) {
            setIsPositioned(false);
            return;
        }

        const updatePosition = () => {
            // Find the container in the document
            const container = document.querySelector(containerSelector) as HTMLElement;
            if (!container) return;

            const containerRect = container.getBoundingClientRect();
            const viewportHeight = window.innerHeight;

            // Check if container bottom is visible in viewport
            const containerBottom = containerRect.bottom;
            const isContainerFullyVisible = containerBottom <= viewportHeight - bufferDistance;

            // Calculate horizontal center
            const containerLeft = containerRect.left;
            const containerWidth = containerRect.width;
            const centerX = containerLeft + containerWidth / 2;

            if (isContainerFullyVisible) {
                // Position relative to container bottom
                setPosition({
                    bottom: `${viewportHeight - containerBottom + bottomOffset}px`,
                    left: `${centerX}px`,
                });
            } else {
                // Position relative to viewport bottom, centered in container
                setPosition({
                    bottom: '2.5rem',
                    left: `${centerX}px`,
                });
            }

            setIsPositioned(true);
        };

        updatePosition();
        window.addEventListener('scroll', updatePosition);
        window.addEventListener('resize', updatePosition);

        return () => {
            window.removeEventListener('scroll', updatePosition);
            window.removeEventListener('resize', updatePosition);
        };
    }, [selectionCount, containerSelector, bufferDistance]);

    return {
        position,
        isPositioned,
        shouldShow: selectionCount > 0 && isPositioned,
    };
}
