import { Money } from '@/vdb/components/data-display/money.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { FullWidthPageBlock, Page, PageLayout } from '@/vdb/framework/layout-engine/page-layout.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { useState } from 'react';
import { withDescription } from '../../../../.storybook/with-description.js';
import { PaginatedListDataTable } from './paginated-list-data-table.js';

// GraphQL query for products list
const productsListDocument = graphql(`
    query ProductsList($options: ProductListOptions) {
        products(options: $options) {
            items {
                id
                createdAt
                updatedAt
                name
                slug
                description
                enabled
                featuredAsset {
                    id
                    preview
                }
                variants {
                    id
                    name
                    sku
                    price
                    priceWithTax
                    currencyCode
                }
            }
            totalItems
        }
    }
`);

const meta = {
    title: 'Framework/PaginatedListDataTable',
    component: PaginatedListDataTable,
    ...withDescription(import.meta.url, './paginated-list-data-table.js'),
    parameters: {
        layout: 'fullscreen',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof PaginatedListDataTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    render: () => {
        const [page, setPage] = useState(1);
        const [pageSize, setPageSize] = useState(10);
        const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
        const [filters, setFilters] = useState<ColumnFiltersState>([]);

        return (
            <div className="p-6">
                <Page pageId="test-page">
                    <PageLayout>
                        <FullWidthPageBlock blockId="test-block">
                            <PaginatedListDataTable
                                listQuery={productsListDocument}
                                defaultVisibility={{
                                    id: false,
                                    updatedAt: false,
                                    description: false,
                                    slug: false,
                                    variants: false,
                                }}
                                customizeColumns={{
                                    name: {
                                        header: 'Product Name',
                                        cell: ({ cell, row }) => {
                                            const value = cell.getValue() as string;
                                            return (
                                                <div className="flex items-center gap-2">
                                                    {row.original.featuredAsset && (
                                                        <img
                                                            src={row.original.featuredAsset.preview}
                                                            alt={value}
                                                            className="w-8 h-8 rounded object-cover"
                                                        />
                                                    )}
                                                    <span className="font-medium">{value}</span>
                                                </div>
                                            );
                                        },
                                    },
                                    enabled: {
                                        header: 'Status',
                                        cell: ({ cell }) => {
                                            const value = cell.getValue() as boolean;
                                            return (
                                                <Badge variant={value ? 'default' : 'secondary'}>
                                                    {value ? 'Enabled' : 'Disabled'}
                                                </Badge>
                                            );
                                        },
                                    },
                                    slug: {
                                        header: 'Slug',
                                        cell: ({ cell }) => {
                                            const value = cell.getValue() as string;
                                            return (
                                                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                                                    {value}
                                                </code>
                                            );
                                        },
                                    },
                                }}
                                additionalColumns={{
                                    variantCount: {
                                        header: 'Variants',
                                        accessorFn: row => row.variants?.length ?? 0,
                                        cell: ({ cell }) => {
                                            const count = cell.getValue() as number;
                                            return <span className="text-muted-foreground">{count}</span>;
                                        },
                                    },
                                    price: {
                                        header: 'Price Range',
                                        accessorFn: row => {
                                            const variants = row.variants ?? [];
                                            if (variants.length === 0) return null;
                                            const prices = variants.map(v => v.price);
                                            const min = Math.min(...prices);
                                            const max = Math.max(...prices);
                                            return { min, max, currency: variants[0].currencyCode };
                                        },
                                        cell: ({ cell }) => {
                                            const value = cell.getValue() as {
                                                min: number;
                                                max: number;
                                                currency: string;
                                            } | null;
                                            if (!value) return null;
                                            if (value.min === value.max) {
                                                return <Money value={value.min} currency={value.currency} />;
                                            }
                                            return (
                                                <span>
                                                    <Money value={value.min} currency={value.currency} /> -{' '}
                                                    <Money value={value.max} currency={value.currency} />
                                                </span>
                                            );
                                        },
                                        meta: {
                                            dependencies: ['variants'],
                                        },
                                    },
                                }}
                                defaultColumnOrder={[
                                    'name',
                                    'slug',
                                    'enabled',
                                    'variantCount',
                                    'price',
                                    'createdAt',
                                ]}
                                onSearchTermChange={searchTerm => {
                                    if (!searchTerm) return {};
                                    return {
                                        name: { contains: searchTerm },
                                    };
                                }}
                                page={page}
                                itemsPerPage={pageSize}
                                sorting={sorting}
                                columnFilters={filters}
                                onPageChange={(_, page, perPage) => {
                                    setPage(page);
                                    setPageSize(perPage);
                                }}
                                onSortChange={(_, sorting) => {
                                    setSorting(sorting);
                                }}
                                onFilterChange={(_, filters) => {
                                    setFilters(filters);
                                }}
                                facetedFilters={{
                                    enabled: {
                                        title: 'Status',
                                        options: [
                                            { label: 'Enabled', value: true },
                                            { label: 'Disabled', value: false },
                                        ],
                                    },
                                }}
                                rowActions={[
                                    {
                                        label: 'Edit',
                                        onClick: row => console.log('Edit product:', row.original.id),
                                    },
                                    {
                                        label: 'Duplicate',
                                        onClick: row => console.log('Duplicate product:', row.original.id),
                                    },
                                ]}
                            />
                        </FullWidthPageBlock>
                    </PageLayout>
                </Page>
            </div>
        );
    },
};
