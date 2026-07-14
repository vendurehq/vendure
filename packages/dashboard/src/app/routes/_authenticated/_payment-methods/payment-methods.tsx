import { BooleanDisplayBadge } from '@/vdb/components/data-display/boolean.js';
import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { RichTextDescriptionCell } from '@/vdb/components/shared/table-cell/order-table-cell-components.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import {
    AssignPaymentMethodsToChannelBulkAction,
    DeletePaymentMethodsBulkAction,
    RemovePaymentMethodsFromChannelBulkAction,
} from './components/payment-method-bulk-actions.js';
import { paymentMethodListQuery } from './payment-methods.graphql.js';

export const Route = createFileRoute('/_authenticated/_payment-methods/payment-methods')({
    component: PaymentMethodListPage,
    loader: () => ({ breadcrumb: () => <Trans>Payment Methods</Trans> }),
});

function PaymentMethodListPage() {
    const { t } = useLingui();
    return (
        <ListPage
            pageId="payment-method-list"
            listQuery={paymentMethodListQuery}
            route={Route}
            title={<Trans>Payment Methods</Trans>}
            defaultVisibility={{
                name: true,
                code: true,
                enabled: true,
            }}
            onSearchTermChange={searchTerm => {
                return {
                    name: { contains: searchTerm },
                };
            }}
            facetedFilters={{
                enabled: {
                    title: t`Enabled`,
                    options: [
                        { label: 'Enabled', value: true },
                        { label: 'Disabled', value: false },
                    ],
                },
            }}
            customizeColumns={{
                name: {
                    cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
                },
                enabled: {
                    cell: ({ row }) => <BooleanDisplayBadge value={row.original.enabled} />,
                },
                description: {
                    cell: RichTextDescriptionCell,
                },
            }}
            bulkActions={[
                [
                    {
                        component: AssignPaymentMethodsToChannelBulkAction,
                        order: 100,
                    },
                    {
                        component: RemovePaymentMethodsFromChannelBulkAction,
                        order: 200,
                    },
                ],
                [
                    {
                        component: DeletePaymentMethodsBulkAction,
                    },
                ],
            ]}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreatePaymentMethod']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    <Trans>New Payment Method</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
