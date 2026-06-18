import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { DeleteZonesBulkAction } from './components/zone-bulk-actions.js';
import { ZoneCountriesSheet } from './components/zone-countries-sheet.js';
import { zoneListQuery } from './zones.graphql.js';

export const Route = createFileRoute('/_authenticated/_zones/zones')({
    component: ZoneListPage,
    loader: () => ({ breadcrumb: () => <Trans>Zones</Trans> }),
});

function ZoneListPage() {
    const { t } = useLingui();
    return (
        <ListPage
            pageId="zone-list"
            listQuery={zoneListQuery}
            route={Route}
            title={<Trans>Zones</Trans>}
            defaultVisibility={{
                name: true,
                regions: true,
            }}
            customizeColumns={{
                name: {
                    cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
                },
            }}
            additionalColumns={{
                regions: {
                    header: t`Regions`,
                    cell: ({ row }) => (
                        <ZoneCountriesSheet zoneId={row.original.id} zoneName={row.original.name}>
                            <Trans>Edit members</Trans>
                        </ZoneCountriesSheet>
                    ),
                },
            }}
            bulkActions={[
                {
                    component: DeleteZonesBulkAction,
                },
            ]}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreateZone']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon />
                    <Trans>New Zone</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
