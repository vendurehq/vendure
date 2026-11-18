import { Table } from '@tanstack/react-table';
import { describe, expect, it } from 'vitest';
import { getMissingRowIds, resolveSelectedItems } from './data-table-bulk-actions.js';

interface Item {
    id: string;
    name: string;
}

function createTable(selectedIds: string[], currentPageItems: Item[]) {
    const itemsById = new Map(currentPageItems.map(item => [item.id, item]));
    return {
        getState: () => ({
            rowSelection: Object.fromEntries(selectedIds.map(id => [id, true])),
        }),
        getRow: (id: string) => {
            const item = itemsById.get(id);
            if (!item) {
                throw new Error(`Row ${id} is not on the current page`);
            }
            return { original: item };
        },
    } as unknown as Table<Item>;
}

describe('resolveSelectedItems', () => {
    it('uses controlled items when a selected row is not on the current page', () => {
        const selectedItem = { id: 'asset-1', name: 'Selected in grid view' };
        const table = createTable([selectedItem.id], []);

        expect(resolveSelectedItems(table, new Map(), [selectedItem])).toEqual([selectedItem]);
    });

    it('refreshes cached items from the controlled selection', () => {
        const staleItem = { id: 'asset-1', name: 'Old name' };
        const currentItem = { id: 'asset-1', name: 'New name' };
        const cache = new Map([[staleItem.id, staleItem]]);
        const table = createTable([currentItem.id], []);

        expect(resolveSelectedItems(table, cache, [currentItem])).toEqual([currentItem]);
    });
});

describe('getMissingRowIds', () => {
    it('lists the selected ids that have no loaded row', () => {
        const loaded = [{ id: '1', name: 'On this page' }];

        expect(getMissingRowIds(['1', '2', '3'], loaded)).toEqual(['2', '3']);
    });

    it('is empty when every selected id has a loaded row', () => {
        const loaded = [
            { id: '1', name: 'One' },
            { id: '2', name: 'Two' },
        ];

        expect(getMissingRowIds(['1', '2'], loaded)).toEqual([]);
    });
});
