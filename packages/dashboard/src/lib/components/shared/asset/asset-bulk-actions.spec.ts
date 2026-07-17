import { Table } from '@tanstack/react-table';
import { createElement, isValidElement, type FunctionComponent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Asset } from './asset-gallery.js';
import {
    adaptAssetBulkActions,
    type AssetBulkActionComponent,
    type AssetBulkActionsInput,
} from './asset-bulk-actions.js';

describe('adaptAssetBulkActions', () => {
    it('keeps the legacy refetch callback while supplying the data-table context', () => {
        const refetch = vi.fn();
        const LegacyAction: AssetBulkActionComponent = props => createElement('button', props);
        const input: AssetBulkActionsInput = [{ component: LegacyAction }];
        const [adaptedAction] = adaptAssetBulkActions(input, refetch) as Array<{
            component: FunctionComponent<any>;
        }>;
        const table = { resetRowSelection: vi.fn() } as unknown as Table<Asset>;
        const selection = [{ id: 'asset-1' }] as Asset[];

        const element = adaptedAction.component({ selection, table });

        expect(isValidElement(element)).toBe(true);
        expect(element).toMatchObject({
            props: {
                selection,
                table,
                refetch,
            },
        });
    });
});
