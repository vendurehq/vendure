import { Card, CardFooter } from '@/vdb/components/ui/card.js';
import { Field, FieldLabel } from '@/vdb/components/ui/field.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import {
    DetailFormGrid,
    PageBlock,
    PageBlockProps,
    PageLayout,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { PageContext } from '@/vdb/framework/layout-engine/page-provider.js';
import { PageSkeletonContext } from '@/vdb/framework/layout-engine/page-skeleton-context.js';
import { useCustomFieldConfig } from '@/vdb/hooks/use-custom-field-config.js';
import { useIsServerConfigLoaded } from '@/vdb/hooks/use-server-config.js';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable as UiDataTable } from '@vendure-io/ui/components/molecules/data-table/data-table';
import React from 'react';

/**
 * One block of a {@link DetailPageSkeletonLayout}: a card in the page's own
 * column and order, drawn as a skeleton of what it holds.
 */
export interface DetailPageSkeletonBlock {
    column: PageBlockProps['column'];
    /**
     * The `blockId` of the page's block. Extension blocks registered for the
     * page are placed before, after or instead of the block with this id.
     */
    blockId: string;
    /**
     * What the block holds:
     *
     * - `form` (default): rows of two fields.
     * - `table`: a data table with its header, column row, rows and pagination.
     * - `list`: lines of text or chips.
     * - `media`: an image or preview, with `rows` lines under it.
     * - `custom-fields`: the fields of `entityType`, as `CustomFieldsPageBlock`
     *   draws them. Nothing when the entity has no custom fields.
     */
    content?: 'form' | 'table' | 'list' | 'media' | 'custom-fields';
    /** The entity type of a `custom-fields` block. */
    entityType?: string;
    /** Rows of fields, table rows or lines. */
    rows?: number;
    /** The block has a title row. Tables always have one. */
    title?: boolean;
    /** A form with a text editor after its first row. */
    editor?: boolean;
}

/**
 * The shape of a detail page while its route loads, set as the
 * `pendingSkeleton` static data of the route. The blocks go through
 * `PageLayout`, so the skeleton has the page's columns, and the extension
 * blocks registered for `pageId` show as skeleton cards where the page puts them.
 *
 * @example
 * ```tsx
 * export const Route = createFileRoute('/_authenticated/_products/products_/$id')({
 *     staticData: {
 *         pendingSkeleton: {
 *             pageId: 'product-detail',
 *             blocks: [
 *                 { column: 'main', blockId: 'main-form', editor: true },
 *                 { column: 'main', blockId: 'product-variants-table', content: 'table' },
 *                 { column: 'side', blockId: 'facet-values', content: 'list', title: true },
 *             ],
 *         },
 *     },
 * });
 * ```
 */
export interface DetailPageSkeletonLayout {
    pageId?: string;
    blocks: DetailPageSkeletonBlock[];
}

/** The shape for a detail route that does not set its own. */
export const DEFAULT_DETAIL_SKELETON: DetailPageSkeletonLayout = {
    blocks: [
        { column: 'main', blockId: 'main-form', rows: 2, editor: true },
        { column: 'side', blockId: 'side-1', content: 'list', rows: 2, title: true },
        { column: 'side', blockId: 'side-2', content: 'list', rows: 3, title: true },
    ],
};

const TABLE_ROWS = 10;
const TABLE_COLUMNS = 5;

function FieldSkeleton({ className }: Readonly<{ className?: string }>) {
    return (
        <Field>
            <FieldLabel>
                <Skeleton className="h-[1lh] w-24" />
            </FieldLabel>
            <Skeleton className={className ?? 'h-8.5 w-full'} />
        </Field>
    );
}

function FormSkeleton({ rows, editor }: Readonly<{ rows: number; editor?: boolean }>) {
    return Array.from({ length: rows }, (_, index) => (
        <React.Fragment key={index}>
            <DetailFormGrid>
                <FieldSkeleton />
                <FieldSkeleton />
            </DetailFormGrid>
            {editor && index === 0 && (
                <div className="mb-6">
                    <FieldSkeleton className="h-28 w-full" />
                </div>
            )}
        </React.Fragment>
    ));
}

function ListSkeleton({ rows }: Readonly<{ rows: number }>) {
    return (
        <div className="space-y-3">
            {Array.from({ length: rows }, (_, index) => (
                <Skeleton key={index} className="h-6 w-full" />
            ))}
        </div>
    );
}

const tableColumns: ColumnDef<unknown>[] = Array.from({ length: TABLE_COLUMNS }, (_, index) => ({
    id: `column-${index}`,
    header: () => <Skeleton className="h-[0.8lh] w-16" />,
}));

/**
 * The loading state of a data table in a bare block: the same card, header,
 * column row and rows as the table while its first page loads.
 */
function TableSkeleton({ rows }: Readonly<{ rows: number }>) {
    return (
        <Card>
            <UiDataTable
                frame="plain"
                // Undefined, not empty: the DataTable draws skeleton rows only before its first load.
                rows={undefined}
                columns={tableColumns}
                isLoading
                skeletonRowCount={rows}
                header={
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Skeleton className="h-[1lh] w-32" />
                        <Skeleton className="h-8.5 w-40" />
                    </div>
                }
            />
            <CardFooter className="border-t">
                <div className="flex w-full items-center justify-between gap-4">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-8.5 w-56" />
                </div>
            </CardFooter>
        </Card>
    );
}

/**
 * The custom fields card of `CustomFieldsPageBlock`: one field per custom
 * field of the entity, in the same two-column grid.
 */
function CustomFieldsSkeleton({ column, blockId, entityType }: Readonly<DetailPageSkeletonBlock>) {
    const customFields = useCustomFieldConfig(entityType ?? '');
    const isServerConfigLoaded = useIsServerConfigLoaded();
    const tab = customFields?.[0]?.ui?.tab;
    const fields = isServerConfigLoaded
        ? (customFields ?? []).filter(field => field.ui?.tab === tab).length
        : 2;
    if (fields === 0) {
        return null;
    }
    return (
        <PageBlock column={column} blockId={blockId}>
            <div className="grid gap-6 @md:grid-cols-2">
                {Array.from({ length: fields }, (_, index) => (
                    <FieldSkeleton key={index} />
                ))}
            </div>
        </PageBlock>
    );
}

/**
 * `column` and `blockId` stay props of their own, as on `PageBlock`: `PageLayout`
 * reads them from its children to sort the blocks into columns.
 */
function BlockSkeleton(block: Readonly<DetailPageSkeletonBlock>) {
    const { column, blockId, content = 'form', title } = block;
    if (content === 'custom-fields') {
        return <CustomFieldsSkeleton {...block} />;
    }
    if (content === 'table') {
        return (
            <PageBlock column={column} blockId={blockId} layout="bare">
                <TableSkeleton rows={block.rows ?? TABLE_ROWS} />
            </PageBlock>
        );
    }
    return (
        <PageBlock
            column={column}
            blockId={blockId}
            title={title ? <Skeleton className="h-[1lh] w-28" /> : undefined}
        >
            {content === 'form' && <FormSkeleton rows={block.rows ?? 1} editor={block.editor} />}
            {content === 'list' && <ListSkeleton rows={block.rows ?? 2} />}
            {content === 'media' && (
                <div className="space-y-4">
                    <Skeleton className={column === 'side' ? 'h-40 w-full' : 'h-75 w-full'} />
                    {block.rows ? <ListSkeleton rows={block.rows} /> : null}
                </div>
            )}
        </PageBlock>
    );
}

/**
 * The blocks of a detail page as skeletons, laid out by `PageLayout`.
 */
export function DetailPageSkeletonBlocks({ layout }: Readonly<{ layout: DetailPageSkeletonLayout }>) {
    return (
        <PageContext.Provider value={{ pageId: layout.pageId }}>
            <PageSkeletonContext.Provider value={true}>
                <PageLayout>
                    {layout.blocks.map(block => (
                        <BlockSkeleton key={block.blockId} {...block} />
                    ))}
                </PageLayout>
            </PageSkeletonContext.Provider>
        </PageContext.Provider>
    );
}
