import { Money } from '@/vdb/components/data-display/money.js';
import { getColumnVisibility } from '@/vdb/components/data-table/data-table-utils.js';
import { DataTable } from '@/vdb/components/data-table/data-table.js';
import { useGeneratedColumns } from '@/vdb/components/data-table/use-generated-columns.js';
import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { VendureImage } from '@/vdb/components/shared/vendure-image.js';
import { Button } from '@/vdb/components/ui/button.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/vdb/components/ui/dropdown-menu.js';
import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { getFieldsFromDocumentNode } from '@/vdb/framework/document-introspection/get-document-structure.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { Trans } from '@lingui/react/macro';
import { JsonViewer } from '@/vdb/components/data-display/json-viewer.js';
import { EllipsisVertical } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import { orderDetailDocument, orderLineFragment } from '../orders.graphql.js';
import { MoneyGrossNet } from './money-gross-net.js';
import { OrderTableTotals } from './order-table-totals.js';

type OrderFragment = NonNullable<ResultOf<typeof orderDetailDocument>['order']>;
type OrderLineFragment = ResultOf<typeof orderLineFragment>;

export interface OrderTableProps {
    order: OrderFragment;
    pageId: string;
}

// Factory function to create customizeColumns with inline components
function createCustomizeColumns(currencyCode: string) {
    return {
        featuredAsset: {
            header: () => <Trans>Image</Trans>,
            accessorKey: 'featuredAsset',
            cell: ({ row }: { row: any }) => {
                const asset = row.original.featuredAsset;
                const fallbackAsset =
                    row.original.productVariant?.featuredAsset ??
                    row.original.productVariant?.product?.featuredAsset;
                return <VendureImage asset={asset ?? fallbackAsset} preset="tiny" />;
            },
        },
        productVariant: {
            header: () => <Trans>Product</Trans>,
            cell: ({ row }: { row: any }) => {
                const productVariant = row.original.productVariant;
                return (
                    <DetailPageButton
                        id={productVariant.id}
                        label={productVariant.name}
                        href={`/product-variants/${productVariant.id}`}
                    />
                );
            },
        },
        unitPriceWithTax: {
            header: () => <Trans>Unit price</Trans>,
            accessorKey: 'unitPriceWithTax',
            cell: ({ row }: { row: any }) => {
                const value = row.original.unitPriceWithTax;
                const netValue = row.original.unitPrice;
                return <MoneyGrossNet priceWithTax={value} price={netValue} currencyCode={currencyCode} />;
            },
        },
        fulfillmentLines: {
            cell: ({ row }: { row: any }) => (
                <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                        <EllipsisVertical />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <JsonViewer data={row.original.fulfillmentLines} viewOnly rootFontSize={12} />
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
        },
        quantity: {
            header: () => <Trans>Quantity</Trans>,
            accessorKey: 'quantity',
        },
        unitPrice: {
            cell: ({ row }: { row: any }) => <Money currency={currencyCode} value={row.original.unitPrice} />,
        },
        proratedUnitPrice: {
            cell: ({ row }: { row: any }) => (
                <Money currency={currencyCode} value={row.original.proratedUnitPrice} />
            ),
        },
        proratedUnitPriceWithTax: {
            cell: ({ row }: { row: any }) => (
                <Money currency={currencyCode} value={row.original.proratedUnitPriceWithTax} />
            ),
        },
        linePrice: {
            cell: ({ row }: { row: any }) => <Money currency={currencyCode} value={row.original.linePrice} />,
        },
        discountedLinePrice: {
            cell: ({ row }: { row: any }) => (
                <Money currency={currencyCode} value={row.original.discountedLinePrice} />
            ),
        },
        lineTax: {
            cell: ({ row }: { row: any }) => <Money currency={currencyCode} value={row.original.lineTax} />,
        },
        linePriceWithTax: {
            header: () => <Trans>Total</Trans>,
            accessorKey: 'linePriceWithTax',
            cell: ({ row }: { row: any }) => {
                const value = row.original.linePriceWithTax;
                const netValue = row.original.linePrice;
                return <MoneyGrossNet priceWithTax={value} price={netValue} currencyCode={currencyCode} />;
            },
        },
        discountedLinePriceWithTax: {
            cell: ({ row }: { row: any }) => (
                <Money currency={currencyCode} value={row.original.discountedLinePriceWithTax} />
            ),
        },
        discounts: {
            header: () => <Trans>Discounts</Trans>,
            cell: ({ row }: { row: any }) => {
                const discounts = row.original.discounts;
                if (!discounts?.length) return null;
                return (
                    <div className="grid grid-cols-[auto_1fr] items-start gap-x-2 gap-y-1">
                        {discounts.map((discount: any, index: number) => (
                            <Fragment key={index}>
                                <span>{discount.description}</span>
                                <MoneyGrossNet
                                    priceWithTax={discount.amountWithTax}
                                    price={discount.amount}
                                    currencyCode={currencyCode}
                                />
                            </Fragment>
                        ))}
                    </div>
                );
            },
        },
    };
}

export function OrderTable({ order, pageId }: Readonly<OrderTableProps>) {
    const { setTableSettings, settings } = useUserSettings();
    const tableSettings = pageId ? settings.tableSettings?.[pageId] : undefined;

    const defaultColumnVisibility = tableSettings?.columnVisibility ?? {
        featuredAsset: true,
        productVariant: true,
        unitPriceWithTax: true,
        quantity: true,
        linePriceWithTax: true,
    };
    const columnOrder = tableSettings?.columnOrder ?? [
        'featuredAsset',
        'productVariant',
        'unitPriceWithTax',
        'quantity',
        'linePriceWithTax',
    ];
    const currencyCode = order.currencyCode;

    const fields = getFieldsFromDocumentNode(
        addCustomFields(orderDetailDocument, { includeNestedFragments: ['OrderLine'] }),
        ['order', 'lines'],
    );

    const customizeColumns = useMemo(() => createCustomizeColumns(currencyCode), [currencyCode]);

    const { columns, customFieldColumnNames } = useGeneratedColumns({
        fields,
        rowActions: [],
        customizeColumns: customizeColumns as any,
        deleteMutation: undefined,
        defaultColumnOrder: columnOrder,
        includeSelectionColumn: false,
        includeActionsColumn: false,
        enableSorting: false,
    });

    const columnVisibility = getColumnVisibility(columns, defaultColumnVisibility, customFieldColumnNames);
    const visibleColumnCount = Object.values(columnVisibility).filter(Boolean).length - 2; // -2 for "actions" and "selection" cols
    const data = order.lines;

    return (
        <div className="w-full">
            <DataTable
                columns={columns as any}
                data={data as any}
                totalItems={data.length}
                itemsPerPage={data.length}
                disableViewOptions={false}
                defaultColumnVisibility={columnVisibility}
                onColumnVisibilityChange={(_, columnVisibility) => {
                    setTableSettings(pageId, 'columnVisibility', columnVisibility);
                }}
                setTableOptions={options => ({
                    ...options,
                    manualPagination: false,
                    manualSorting: false,
                    manualFiltering: false,
                })}
            >
                <OrderTableTotals order={order} columnCount={visibleColumnCount} />
            </DataTable>
        </div>
    );
}
