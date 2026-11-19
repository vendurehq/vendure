import { JsonViewer } from '@/vdb/components/data-display/json-viewer.js';
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
import { Trans, useLingui } from '@lingui/react/macro';
import { Ellipsis } from 'lucide-react';
import { Fragment, ReactNode, useMemo } from 'react';

import { orderDetailDocument, orderLineFragment } from '../orders.graphql.js';

import { MoneyGrossNet } from './money-gross-net.js';
import { OrderTableTotals } from './order-table-totals.js';

type OrderFragment = NonNullable<ResultOf<typeof orderDetailDocument>['order']>;
type OrderLineFragment = ResultOf<typeof orderLineFragment>;

export interface OrderTableProps {
    order: OrderFragment;
    pageId: string;
}

// Numbers align to the end of their column, header included.
function NumericCell({ children }: Readonly<{ children: ReactNode }>) {
    return <div className="text-end">{children}</div>;
}

// Factory function to create customizeColumns with inline components
function FulfillmentLinesMenu({ fulfillmentLines }: Readonly<{ fulfillmentLines: unknown }>) {
    const { t } = useLingui();
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" aria-label={t`Show fulfillment lines`} />}
            >
                <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                <JsonViewer data={fulfillmentLines} viewOnly rootFontSize={12} />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

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
            header: () => (
                <NumericCell>
                    <Trans>Unit price</Trans>
                </NumericCell>
            ),
            accessorKey: 'unitPriceWithTax',
            cell: ({ row }: { row: any }) => {
                const value = row.original.unitPriceWithTax;
                const netValue = row.original.unitPrice;
                return (
                    <NumericCell>
                        <MoneyGrossNet priceWithTax={value} price={netValue} currencyCode={currencyCode} />
                    </NumericCell>
                );
            },
        },
        fulfillmentLines: {
            cell: ({ row }: { row: any }) => (
                <FulfillmentLinesMenu fulfillmentLines={row.original.fulfillmentLines} />
            ),
        },
        quantity: {
            header: () => (
                <NumericCell>
                    <Trans>Quantity</Trans>
                </NumericCell>
            ),
            accessorKey: 'quantity',
            cell: ({ row }: { row: any }) => (
                <NumericCell>
                    <span className="tabular-nums">{row.original.quantity}</span>
                </NumericCell>
            ),
        },
        unitPrice: {
            cell: ({ row }: { row: any }) => (
                <NumericCell>
                    <Money currency={currencyCode} value={row.original.unitPrice} />
                </NumericCell>
            ),
        },
        proratedUnitPrice: {
            cell: ({ row }: { row: any }) => (
                <NumericCell>
                    <Money currency={currencyCode} value={row.original.proratedUnitPrice} />
                </NumericCell>
            ),
        },
        proratedUnitPriceWithTax: {
            cell: ({ row }: { row: any }) => (
                <NumericCell>
                    <Money currency={currencyCode} value={row.original.proratedUnitPriceWithTax} />
                </NumericCell>
            ),
        },
        linePrice: {
            cell: ({ row }: { row: any }) => (
                <NumericCell>
                    <Money currency={currencyCode} value={row.original.linePrice} />
                </NumericCell>
            ),
        },
        discountedLinePrice: {
            cell: ({ row }: { row: any }) => (
                <NumericCell>
                    <Money currency={currencyCode} value={row.original.discountedLinePrice} />
                </NumericCell>
            ),
        },
        lineTax: {
            cell: ({ row }: { row: any }) => (
                <NumericCell>
                    <Money currency={currencyCode} value={row.original.lineTax} />
                </NumericCell>
            ),
        },
        linePriceWithTax: {
            header: () => (
                <NumericCell>
                    <Trans>Total</Trans>
                </NumericCell>
            ),
            accessorKey: 'linePriceWithTax',
            cell: ({ row }: { row: any }) => {
                const value = row.original.linePriceWithTax;
                const netValue = row.original.linePrice;
                return (
                    <NumericCell>
                        <MoneyGrossNet priceWithTax={value} price={netValue} currencyCode={currencyCode} />
                    </NumericCell>
                );
            },
        },
        discountedLinePriceWithTax: {
            cell: ({ row }: { row: any }) => (
                <NumericCell>
                    <Money currency={currencyCode} value={row.original.discountedLinePriceWithTax} />
                </NumericCell>
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
    const data = order.lines;

    return (
        <div className="w-full">
            <DataTable
                title={<Trans>Order items</Trans>}
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
                footerRows={({ columnCount }) => <OrderTableTotals order={order} columnCount={columnCount} />}
            />
        </div>
    );
}
