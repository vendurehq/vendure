import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { RichTextDescriptionCell } from '@/vdb/components/shared/table-cell/order-table-cell-components.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import {
    AssignShippingMethodsToChannelBulkAction,
    DeleteShippingMethodsBulkAction,
    RemoveShippingMethodsFromChannelBulkAction,
} from './components/shipping-method-bulk-actions.js';
import { TestShippingMethodsSheet } from './components/test-shipping-methods-sheet.js';
import { shippingMethodListQuery } from './shipping-methods.graphql.js';

export const Route = createFileRoute('/_authenticated/_shipping-methods/shipping-methods')({
    component: ShippingMethodListPage,
    loader: () => ({ breadcrumb: () => <Trans>Shipping Methods</Trans> }),
});

function ShippingMethodListPage() {
    return (
        <ListPage
            pageId="shipping-method-list"
            listQuery={shippingMethodListQuery}
            route={Route}
            title={<Trans>Shipping Methods</Trans>}
            defaultVisibility={{
                name: true,
                code: true,
                fulfillmentHandlerCode: true,
            }}
            customizeColumns={{
                name: {
                    cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
                },
                description: {
                    cell: RichTextDescriptionCell,
                },
            }}
            onSearchTermChange={searchTerm => {
                return {
                    name: { contains: searchTerm },
                };
            }}
            bulkActions={[
                [
                    {
                        component: AssignShippingMethodsToChannelBulkAction,
                        order: 100,
                    },
                    {
                        component: RemoveShippingMethodsFromChannelBulkAction,
                        order: 200,
                    },
                ],
                [
                    {
                        component: DeleteShippingMethodsBulkAction,
                    },
                ],
            ]}
        >
            <ActionBarItem itemId="test-shipping-button">
                <TestShippingMethodsSheet />
            </ActionBarItem>
            <ActionBarItem itemId="create-button" requiresPermission={['CreateShippingMethod']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    <Trans>New Shipping Method</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
