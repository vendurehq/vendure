import { BooleanDisplayBadge } from '@/vdb/components/data-display/boolean.js';
import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { RichTextDescriptionCell } from '@/vdb/components/shared/table-cell/order-table-cell-components.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import {
    AssignPromotionsToChannelBulkAction,
    DeletePromotionsBulkAction,
    DuplicatePromotionsBulkAction,
    RemovePromotionsFromChannelBulkAction,
} from './components/promotion-bulk-actions.js';
import { promotionListDocument } from './promotions.graphql.js';

export const Route = createFileRoute('/_authenticated/_promotions/promotions')({
    component: PromotionListPage,
    loader: () => ({ breadcrumb: () => <Trans>Promotions</Trans> }),
});

function PromotionListPage() {
    const { t } = useLingui();
    return (
        <ListPage
            pageId="promotion-list"
            listQuery={promotionListDocument}
            route={Route}
            title={<Trans>Promotions</Trans>}
            defaultSort={[{ id: 'createdAt', desc: true }]}
            defaultVisibility={{
                name: true,
                couponCode: true,
                enabled: true,
                startsAt: true,
                endsAt: true,
            }}
            searchPlaceholder={t`Search promotions...`}
            onSearchTermChange={searchTerm => {
                return searchTerm
                    ? {
                          name: { contains: searchTerm },
                          couponCode: { contains: searchTerm },
                      }
                    : {};
            }}
            transformVariables={variables => {
                return {
                    options: {
                        ...variables.options,
                        filterOperator: 'OR' as const,
                    },
                };
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
            emptyStateAction={
                <PermissionGuard requires={['CreatePromotion']}>
                    <Button render={<Link to="./new" />}>
                        <PlusIcon className="mr-2 h-4 w-4" />
                        <Trans>Create your first promotion</Trans>
                    </Button>
                </PermissionGuard>
            }
            bulkActions={[
                [
                    {
                        order: 100,
                        component: AssignPromotionsToChannelBulkAction,
                    },
                    {
                        order: 200,
                        component: RemovePromotionsFromChannelBulkAction,
                    },
                    {
                        order: 300,
                        component: DuplicatePromotionsBulkAction,
                    },
                ],
                [
                    {
                        component: DeletePromotionsBulkAction,
                    },
                ],
            ]}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreatePromotion']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    <Trans>New Promotion</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
