import { SingleRelationInput } from '@/vdb/components/data-input/relation-input.js';
import { ProductVariantSelector } from '@/vdb/components/shared/product-variant-selector.js';
import { VendureImage } from '@/vdb/components/shared/vendure-image.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';
import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
    VisibilityState,
} from '@tanstack/react-table';
import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
    couponCodeSelectorPromotionListDocument,
    draftOrderEligibleShippingMethodsDocument,
    orderDetailDocument,
    orderLineFragment,
} from '../orders.graphql.js';
import { MoneyGrossNet } from './money-gross-net.js';
import { OrderLineCustomFieldsForm } from './order-line-custom-fields-form.js';
import { OrderTableTotals } from './order-table-totals.js';
import { ShippingMethodSelector } from './shipping-method-selector.js';

type OrderFragment = NonNullable<ResultOf<typeof orderDetailDocument>['order']>;
type OrderLineFragment = ResultOf<typeof orderLineFragment>;

type ShippingMethodQuote = ResultOf<
    typeof draftOrderEligibleShippingMethodsDocument
>['eligibleShippingMethodsForDraftOrder'][number];

export interface OrderTableProps {
    order: OrderFragment;
    eligibleShippingMethods: ShippingMethodQuote[];
    onAddItem: (variant: {
        productVariantId: string;
        productVariantName: string;
        sku: string;
        productAsset: any;
        price?: any;
        priceWithTax?: any;
    }) => void;
    onAdjustLine: (event: {
        lineId: string;
        quantity: number;
        customFields: Record<string, any> | undefined;
    }) => void;
    onRemoveLine: (event: { lineId: string }) => void;
    onSetShippingMethod: (event: { shippingMethodId: string }) => void;
    onApplyCouponCode: (event: { couponCode: string }) => void;
    onRemoveCouponCode: (event: { couponCode: string }) => void;
    displayTotals?: boolean;
}

export function EditOrderTable({
    order,
    eligibleShippingMethods,
    onAddItem,
    onAdjustLine,
    onRemoveLine,
    onSetShippingMethod,
    onApplyCouponCode,
    onRemoveCouponCode,
    displayTotals = true,
}: Readonly<OrderTableProps>) {
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
    const { t } = useLingui();
    const currencyCode = order.currencyCode;
    const columns: ColumnDef<OrderLineFragment & { customFields?: Record<string, any> }>[] = useMemo(
        () => [
            {
                header: '',
                accessorKey: 'featuredAsset',
                cell: ({ row }) => {
                    const asset = row.original.featuredAsset;
                    const removing = row.original.quantity === 0;
                    return (
                        <VendureImage className={removing ? 'opacity-50' : ''} asset={asset} preset="tiny" />
                    );
                },
            },
            {
                header: t`Product`,
                accessorKey: 'productVariant.name',
                cell: ({ row }) => {
                    const value = row.original.productVariant.name;
                    const removing = row.original.quantity === 0;
                    return <div className={removing ? 'text-muted-foreground' : ''}>{value}</div>;
                },
            },
            {
                header: t`SKU`,
                accessorKey: 'productVariant.sku',
            },
            {
                header: t`Unit price`,
                accessorKey: 'unitPriceWithTax',
                cell: ({ row }) => {
                    const value = row.original.unitPriceWithTax;
                    const netValue = row.original.unitPrice;
                    return (
                        <MoneyGrossNet priceWithTax={value} price={netValue} currencyCode={currencyCode} />
                    );
                },
            },
            {
                header: t`Quantity`,
                accessorKey: 'quantity',
                cell: ({ row }) => {
                    return (
                        <div className="flex gap-2">
                            <Input
                                type="number"
                                value={row.original.quantity}
                                min={0}
                                data-testid="order-line-quantity"
                                onChange={e => {
                                    const value = Number.isNaN(e.target.valueAsNumber)
                                        ? 0
                                        : e.target.valueAsNumber;
                                    onAdjustLine({
                                        lineId: row.original.id,
                                        quantity: value,
                                        customFields: row.original.customFields,
                                    });
                                }}
                            />
                            <Button
                                variant="outline"
                                type="button"
                                size="icon"
                                disabled={row.original.quantity === 0}
                                onClick={() => onRemoveLine({ lineId: row.original.id })}
                            >
                                <Trash2 />
                            </Button>
                            {row.original.customFields && (
                                <OrderLineCustomFieldsForm
                                    onUpdate={customFields => {
                                        onAdjustLine({
                                            lineId: row.original.id,
                                            quantity: row.original.quantity,
                                            customFields: customFields,
                                        });
                                    }}
                                    value={row.original.customFields}
                                />
                            )}
                        </div>
                    );
                },
            },
            {
                header: t`Total`,
                accessorKey: 'linePriceWithTax',
                cell: ({ row }) => {
                    const value = row.original.linePriceWithTax;
                    const netValue = row.original.linePrice;
                    return (
                        <MoneyGrossNet priceWithTax={value} price={netValue} currencyCode={currencyCode} />
                    );
                },
            },
        ],
        [],
    );

    const data = order.lines;

    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        rowCount: data.length,
        onColumnVisibilityChange: setColumnVisibility,
        state: {
            columnVisibility,
        },
    });

    return (
        <div className="w-full">
            <div className="">
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
                        {table.getRowModel().rows?.length
                            ? table.getRowModel().rows.map(row => (
                                  <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                                      {row.getVisibleCells().map(cell => (
                                          <TableCell key={cell.id}>
                                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                          </TableCell>
                                      ))}
                                  </TableRow>
                              ))
                            : null}
                        <TableRow>
                            <TableCell colSpan={columns.length} className="h-12">
                                <div className="my-4 flex justify-center">
                                    <div className="max-w-lg">
                                        <ProductVariantSelector onProductVariantSelect={onAddItem} />
                                    </div>
                                </div>
                            </TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell colSpan={columns.length} className="h-12">
                                <ShippingMethodSelector
                                    eligibleShippingMethods={eligibleShippingMethods}
                                    selectedShippingMethodId={order.shippingLines?.[0]?.shippingMethod?.id}
                                    currencyCode={currencyCode}
                                    onSelect={shippingMethodId => onSetShippingMethod({ shippingMethodId })}
                                />
                            </TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell colSpan={columns.length} className="h-12">
                                <div className="flex gap-4">
                                    {order.couponCodes?.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {order.couponCodes.map(code => (
                                                <div
                                                    key={code}
                                                    className="flex items-center gap-2 px-3 py-1 text-sm border rounded-md"
                                                >
                                                    <span>{code}</span>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 w-6 p-0"
                                                        onClick={() =>
                                                            onRemoveCouponCode({ couponCode: code })
                                                        }
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <SingleRelationInput
                                        config={{
                                            listQuery: couponCodeSelectorPromotionListDocument,
                                            idKey: 'couponCode',
                                            labelKey: 'couponCode',
                                            placeholder: 'Search coupon codes...',
                                            label: (item: any) => `${item.couponCode} (${item.name})`,
                                        }}
                                        value={''}
                                        selectorLabel={<Trans>Add coupon code</Trans>}
                                        onBlur={() => {}}
                                        name={'couponCode'}
                                        ref={() => {}}
                                        onChange={code => onApplyCouponCode({ couponCode: code })}
                                    />
                                </div>
                            </TableCell>
                        </TableRow>
                        {displayTotals && <OrderTableTotals order={order} columnCount={columns.length} />}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
