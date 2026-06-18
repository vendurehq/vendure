import {
    ProductVariantSelector,
    ProductVariantSelectorProps,
} from '@/vdb/components/shared/product-variant-selector.js';
import { AssetLike, VendureImage } from '@/vdb/components/shared/vendure-image.js';
import { AccordionContent, AccordionItem, AccordionTrigger } from '@/vdb/components/ui/accordion.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { LS_KEY_SHIPPING_TEST_ORDER } from '@/vdb/constants.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans } from '@lingui/react/macro';
import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
    VisibilityState,
} from '@tanstack/react-table';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface TestOrderLine {
    id: string;
    name: string;
    featuredAsset?: AssetLike;
    sku: string;
    unitPriceWithTax: number;
    quantity: number;
}

interface TestOrderBuilderProps {
    onOrderLinesChange: (lines: TestOrderLine[]) => void;
}

export function TestOrderBuilder({ onOrderLinesChange }: Readonly<TestOrderBuilderProps>) {
    const { formatCurrency } = useLocalFormat();
    const { activeChannel } = useChannel();
    const [lines, setLines] = useState<TestOrderLine[]>(() => {
        try {
            const stored = localStorage.getItem(LS_KEY_SHIPPING_TEST_ORDER);
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    });
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

    const currencyCode = activeChannel?.defaultCurrencyCode ?? 'USD';
    const subTotal = lines.reduce((sum, l) => sum + l.unitPriceWithTax * l.quantity, 0);

    useEffect(() => {
        try {
            localStorage.setItem(LS_KEY_SHIPPING_TEST_ORDER, JSON.stringify(lines));
        } catch {
            // Ignore localStorage errors
        }
        onOrderLinesChange(lines);
    }, [lines, onOrderLinesChange]);

    const addProduct = (product: Parameters<ProductVariantSelectorProps['onProductVariantSelect']>[0]) => {
        if (!lines.find(l => l.id === product.productVariantId)) {
            const newLine: TestOrderLine = {
                id: product.productVariantId,
                name: product.productVariantName,
                featuredAsset: product.productAsset ?? undefined,
                quantity: 1,
                sku: product.sku,
                unitPriceWithTax: product.priceWithTax || 0,
            };
            setLines(prev => [...prev, newLine]);
        }
    };

    const updateQuantity = (lineId: string, newQuantity: number) => {
        if (newQuantity <= 0) {
            removeLine(lineId);
            return;
        }
        setLines(prev => prev.map(line => (line.id === lineId ? { ...line, quantity: newQuantity } : line)));
    };

    const removeLine = (lineId: string) => {
        setLines(prev => prev.filter(line => line.id !== lineId));
    };

    const columns: ColumnDef<TestOrderLine>[] = [
        {
            header: 'Image',
            accessorKey: 'preview',
            cell: ({ row }) => {
                const asset = row.original.featuredAsset ?? null;
                return <VendureImage asset={asset} preset="tiny" />;
            },
        },
        {
            header: 'Product',
            accessorKey: 'name',
        },
        {
            header: 'SKU',
            accessorKey: 'sku',
        },
        {
            header: 'Unit price',
            accessorKey: 'unitPriceWithTax',
            cell: ({ row }) => {
                return formatCurrency(row.original.unitPriceWithTax, currencyCode);
            },
        },
        {
            header: 'Quantity',
            accessorKey: 'quantity',
            cell: ({ row }) => {
                return (
                    <div className="flex gap-2 items-center">
                        <Input
                            type="number"
                            min="1"
                            value={row.original.quantity}
                            onChange={e => updateQuantity(row.original.id, Number.parseInt(e.target.value) || 1)}
                            className="w-16"
                        />
                        <Button
                            variant="outline"
                            type="button"
                            size="icon"
                            onClick={() => removeLine(row.original.id)}
                            className="h-8 w-8"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                );
            },
        },
        {
            header: 'Total',
            accessorKey: 'total',
            cell: ({ row }) => {
                const total = row.original.unitPriceWithTax * row.original.quantity;
                return formatCurrency(total, currencyCode);
            },
        },
    ];

    const table = useReactTable({
        data: lines,
        columns,
        getCoreRowModel: getCoreRowModel(),
        rowCount: lines.length,
        onColumnVisibilityChange: setColumnVisibility,
        state: {
            columnVisibility,
        },
    });

    return (
        <AccordionItem value="test-order">
            <AccordionTrigger>
                <div className="flex items-center justify-between w-full pr-2">
                    <span>
                        <Trans>Test Order</Trans>
                    </span>
                    {lines.length > 0 && (
                        <span className="text-sm text-muted-foreground">
                            {lines.length} item{lines.length !== 1 ? 's' : ''} •{' '}
                            {formatCurrency(subTotal, currencyCode)}
                        </span>
                    )}
                </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 px-2">
                {lines.length > 0 ? (
                    <div className="w-full">
                        <Table>
                            <TableHeader>
                                {table.getHeaderGroups().map(headerGroup => (
                                    <TableRow key={headerGroup.id}>
                                        {headerGroup.headers.map(header => {
                                            return (
                                                <TableHead key={header.id}>
                                                    {header.isPlaceholder
                                                        ? null
                                                        : flexRender(
                                                              header.column.columnDef.header,
                                                              header.getContext(),
                                                          )}
                                                </TableHead>
                                            );
                                        })}
                                    </TableRow>
                                ))}
                            </TableHeader>
                            <TableBody>
                                {table.getRowModel().rows.map(row => (
                                    <TableRow key={row.id}>
                                        {row.getVisibleCells().map(cell => (
                                            <TableCell key={cell.id}>
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))}
                                <TableRow>
                                    <TableCell colSpan={columns.length} className="h-12">
                                        <div className="my-4 flex justify-center">
                                            <div className="max-w-lg">
                                                <ProductVariantSelector onProductVariantSelect={addProduct} />
                                            </div>
                                        </div>
                                    </TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell
                                        colSpan={columns.length - 1}
                                        className="text-right font-medium"
                                    >
                                        <Trans>Subtotal</Trans>
                                    </TableCell>
                                    <TableCell className="font-medium">
                                        {formatCurrency(subTotal, currencyCode)}
                                    </TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="text-center py-8 text-muted-foreground">
                            <Trans>Add products to create a test order</Trans>
                        </div>
                        <div className="flex justify-center">
                            <div className="max-w-lg">
                                <ProductVariantSelector onProductVariantSelect={addProduct} />
                            </div>
                        </div>
                    </div>
                )}
            </AccordionContent>
        </AccordionItem>
    );
}
