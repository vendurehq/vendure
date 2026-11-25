import type { DragEndEvent } from '@dnd-kit/core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDragAndDrop } from './use-drag-and-drop.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Item = { id: string };

const items: Item[] = [{ id: '1' }, { id: '2' }, { id: '3' }];

function dragEnd(activeId: string, overId: string) {
    return { active: { id: activeId }, over: { id: overId } } as unknown as DragEndEvent;
}

describe('useDragAndDrop', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let renders: Array<{ isLoading: boolean; rows: string[] }>;
    let latest: ReturnType<typeof useDragAndDrop<Item>>;

    function Probe(props: {
        data: Item[];
        isLoading: boolean;
        onReorder?: (oldIndex: number, newIndex: number) => Promise<void>;
        onError?: (error: Error) => void;
    }) {
        latest = useDragAndDrop({ data: props.data, onReorder: props.onReorder, onError: props.onError });
        renders.push({ isLoading: props.isLoading, rows: latest.localData.map(item => item.id) });
        return null;
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        renders = [];
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
    });

    // OSS-1519 — a list flashed its empty state between the skeleton and the rows
    it('has the rows in the same render where loading ends', async () => {
        await act(async () => {
            root.render(<Probe data={[]} isLoading={true} />);
        });
        await act(async () => {
            root.render(<Probe data={items} isLoading={false} />);
        });

        const loaded = renders.filter(render => !render.isLoading);
        expect(loaded.length).toBeGreaterThan(0);
        expect(loaded.every(render => render.rows.length === items.length)).toBe(true);
    });

    it('shows the dropped order while onReorder runs and until the data changes', async () => {
        let finish: () => void = () => undefined;
        const onReorder = vi.fn(() => new Promise<void>(resolve => (finish = resolve)));
        await act(async () => {
            root.render(<Probe data={items} isLoading={false} onReorder={onReorder} />);
        });

        let drop: Promise<void> = Promise.resolve();
        await act(async () => {
            drop = latest.handleDragEnd(dragEnd('1', '3'));
        });
        expect(latest.localData.map(item => item.id)).toEqual(['2', '3', '1']);
        expect(latest.isReordering).toBe(true);

        await act(async () => {
            finish();
            await drop;
        });
        expect(onReorder).toHaveBeenCalledWith(0, 2, items[0], items);
        expect(latest.isReordering).toBe(false);
        expect(latest.localData.map(item => item.id)).toEqual(['2', '3', '1']);

        const refetched = [{ id: '2' }, { id: '3' }, { id: '1' }, { id: '4' }];
        await act(async () => {
            root.render(<Probe data={refetched} isLoading={false} onReorder={onReorder} />);
        });
        expect(latest.localData).toBe(refetched);

        // The drop is forgotten: the first data back does not bring its order back.
        await act(async () => {
            root.render(<Probe data={items} isLoading={false} onReorder={onReorder} />);
        });
        expect(latest.localData).toBe(items);
    });

    it('keeps the dropped order when the data changes while onReorder runs', async () => {
        let finish: () => void = () => undefined;
        const onReorder = vi.fn(() => new Promise<void>(resolve => (finish = resolve)));
        await act(async () => {
            root.render(<Probe data={items} isLoading={false} onReorder={onReorder} />);
        });

        let drop: Promise<void> = Promise.resolve();
        await act(async () => {
            drop = latest.handleDragEnd(dragEnd('1', '3'));
        });
        const refetched = [{ id: '2' }, { id: '3' }, { id: '1' }];
        await act(async () => {
            root.render(<Probe data={refetched} isLoading={false} onReorder={onReorder} />);
        });
        expect(latest.localData.map(item => item.id)).toEqual(['2', '3', '1']);
        expect(latest.localData).not.toBe(refetched);

        await act(async () => {
            finish();
            await drop;
        });
        expect(latest.localData).toBe(refetched);
    });

    it('ignores a second drop while onReorder runs', async () => {
        let finish: () => void = () => undefined;
        const onReorder = vi.fn(() => new Promise<void>(resolve => (finish = resolve)));
        await act(async () => {
            root.render(<Probe data={items} isLoading={false} onReorder={onReorder} />);
        });

        let drop: Promise<void> = Promise.resolve();
        await act(async () => {
            drop = latest.handleDragEnd(dragEnd('1', '3'));
        });
        await act(async () => {
            await latest.handleDragEnd(dragEnd('2', '3'));
        });
        expect(onReorder).toHaveBeenCalledTimes(1);
        expect(latest.localData.map(item => item.id)).toEqual(['2', '3', '1']);

        await act(async () => {
            finish();
            await drop;
        });
    });

    it('goes back to the data order and reports the error when onReorder fails', async () => {
        const error = new Error('failed');
        const onReorder = vi.fn(() => Promise.reject(error));
        const onError = vi.fn();
        await act(async () => {
            root.render(<Probe data={items} isLoading={false} onReorder={onReorder} onError={onError} />);
        });

        await act(async () => {
            await latest.handleDragEnd(dragEnd('1', '3'));
        });
        expect(latest.localData).toBe(items);
        expect(latest.isReordering).toBe(false);
        expect(onError).toHaveBeenCalledWith(error);
    });
});
