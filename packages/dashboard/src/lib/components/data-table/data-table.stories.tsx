import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { FullWidthPageBlock, Page, PageLayout } from '@/vdb/framework/layout-engine/page-layout.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { useState } from 'react';
import { withDescription } from '../../../../.storybook/with-description.js';
import { DataTable } from './data-table.js';

// Sample data type
interface Product {
    id: string;
    name: string;
    category: string;
    price: number;
    stock: number;
    status: 'active' | 'inactive' | 'discontinued';
    createdAt: string;
}

// Sample data
const sampleData: Product[] = Array.from({ length: 100 }, (_, i) => ({
    id: `product-${i + 1}`,
    name: `Product ${i + 1}`,
    category: ['Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Books'][i % 5],
    price: Math.floor(Math.random() * 1000) + 10,
    stock: Math.floor(Math.random() * 100),
    status: (['active', 'inactive', 'discontinued'] as const)[i % 3],
    createdAt: new Date(Date.now() - Math.random() * 10000000000).toISOString(),
}));

const meta = {
    title: 'Framework/DataTable',
    component: DataTable,
    ...withDescription(import.meta.url, './data-table.js'),
    parameters: {
        layout: 'fullscreen',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof DataTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    render: () => {
        const [page, setPage] = useState(1);
        const [pageSize, setPageSize] = useState(10);
        const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
        const [filters, setFilters] = useState<ColumnFiltersState>([]);
        const [searchTerm, setSearchTerm] = useState('');

        // Define columns
        const columns: ColumnDef<Product>[] = [
            {
                id: 'name',
                accessorKey: 'name',
                header: 'Product Name',
                cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
            },
            {
                id: 'category',
                accessorKey: 'category',
                header: 'Category',
                cell: ({ row }) => <span>{row.original.category}</span>,
            },
            {
                id: 'price',
                accessorKey: 'price',
                header: 'Price',
                cell: ({ row }) => <span>${row.original.price.toFixed(2)}</span>,
            },
            {
                id: 'stock',
                accessorKey: 'stock',
                header: 'Stock',
                cell: ({ row }) => {
                    const stock = row.original.stock;
                    return (
                        <Badge variant={stock > 50 ? 'default' : stock > 20 ? 'secondary' : 'destructive'}>
                            {stock}
                        </Badge>
                    );
                },
            },
            {
                id: 'status',
                accessorKey: 'status',
                header: 'Status',
                cell: ({ row }) => {
                    const status = row.original.status;
                    return (
                        <Badge
                            variant={
                                status === 'active'
                                    ? 'default'
                                    : status === 'inactive'
                                      ? 'secondary'
                                      : 'outline'
                            }
                        >
                            {status}
                        </Badge>
                    );
                },
            },
            {
                id: 'createdAt',
                accessorKey: 'createdAt',
                header: 'Created',
                cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
            },
            {
                id: 'actions',
                header: 'Actions',
                cell: ({ row }) => (
                    <div className="flex gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => console.log('Edit', row.original.id)}
                        >
                            Edit
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => console.log('Delete', row.original.id)}
                        >
                            Delete
                        </Button>
                    </div>
                ),
            },
        ];

        // Filter and sort data based on state
        let filteredData = [...sampleData];

        // Apply search filter
        if (searchTerm) {
            filteredData = filteredData.filter(item =>
                item.name.toLowerCase().includes(searchTerm.toLowerCase()),
            );
        }

        // Apply column filters
        filters.forEach(filter => {
            if (filter.id === 'status' && Array.isArray(filter.value)) {
                filteredData = filteredData.filter(item => filter.value.includes(item.status));
            }
            if (filter.id === 'category' && Array.isArray(filter.value)) {
                filteredData = filteredData.filter(item => filter.value.includes(item.category));
            }
        });

        // Apply sorting
        if (sorting.length > 0) {
            const sort = sorting[0];
            filteredData.sort((a, b) => {
                const aValue = a[sort.id as keyof Product];
                const bValue = b[sort.id as keyof Product];
                if (aValue < bValue) return sort.desc ? 1 : -1;
                if (aValue > bValue) return sort.desc ? -1 : 1;
                return 0;
            });
        }

        const totalItems = filteredData.length;
        const paginatedData = filteredData.slice((page - 1) * pageSize, page * pageSize);

        return (
            <div className="p-6">
                <Page pageId="test-page">
                    <PageLayout>
                        <FullWidthPageBlock blockId="test-block">
                            <DataTable
                                columns={columns}
                                data={paginatedData}
                                totalItems={totalItems}
                                page={page}
                                itemsPerPage={pageSize}
                                sorting={sorting}
                                columnFilters={filters}
                                defaultColumnVisibility={{
                                    createdAt: false,
                                }}
                                onPageChange={(_, newPage, newPageSize) => {
                                    setPage(newPage);
                                    setPageSize(newPageSize);
                                }}
                                onSortChange={(_, newSorting) => {
                                    setSorting(newSorting);
                                }}
                                onFilterChange={(_, newFilters) => {
                                    setFilters(newFilters);
                                    setPage(1); // Reset to first page when filters change
                                }}
                                onSearchTermChange={term => {
                                    setSearchTerm(term);
                                    setPage(1); // Reset to first page when search changes
                                }}
                                facetedFilters={{
                                    status: {
                                        title: 'Status',
                                        options: [
                                            { label: 'Active', value: 'active' },
                                            { label: 'Inactive', value: 'inactive' },
                                            { label: 'Discontinued', value: 'discontinued' },
                                        ],
                                    },
                                    category: {
                                        title: 'Category',
                                        options: [
                                            { label: 'Electronics', value: 'Electronics' },
                                            { label: 'Clothing', value: 'Clothing' },
                                            { label: 'Home & Garden', value: 'Home & Garden' },
                                            { label: 'Sports', value: 'Sports' },
                                            { label: 'Books', value: 'Books' },
                                        ],
                                    },
                                }}
                                bulkActions={[
                                    {
                                        label: 'Delete selected',
                                        icon: 'trash',
                                        onClick: (selectedItems: Product[]) => {
                                            console.log('Delete selected:', selectedItems);
                                        },
                                    },
                                    {
                                        label: 'Export selected',
                                        icon: 'download',
                                        onClick: (selectedItems: Product[]) => {
                                            console.log('Export selected:', selectedItems);
                                        },
                                    },
                                ]}
                                onRefresh={() => {
                                    console.log('Refresh data');
                                }}
                            />
                        </FullWidthPageBlock>
                    </PageLayout>
                </Page>
            </div>
        );
    },
};
