import { ColumnFiltersState } from '@tanstack/react-table';

import { ColumnConfig } from '../components/data-table/data-table-context.js';

export interface SavedView {
    id: string;
    name: string;
    scope: 'user' | 'global';
    filters: ColumnFiltersState;
    columnConfig: ColumnConfig;
    searchTerm?: string;
    pageId?: string;
    blockId?: string;
    createdAt: string; // ISO timestamp string
    updatedAt: string; // ISO timestamp string
    createdBy?: string;
}

export interface SavedViewsData {
    userViews: SavedView[];
    globalViews: SavedView[];
}

export interface SavedViewsStore {
    [pageId: string]: {
        [blockId: string]: SavedView[];
    };
}

export interface SaveViewInput {
    name: string;
    scope: 'user' | 'global';
    filters: ColumnFiltersState;
    columnConfig: ColumnConfig;
    searchTerm?: string;
}

export interface UpdateViewInput {
    id: string;
    name?: string;
    filters?: ColumnFiltersState;
    searchTerm?: string;
}
