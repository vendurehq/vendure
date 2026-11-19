import { IdentifierDisplay } from '@/vdb/components/data-display/identifier.js';
import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { NoKeysIllustration } from '@/vdb/components/ui/illustrations.js';
import { RelativeTime } from '@/vdb/components/ui/relative-time.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { apiKeyListQuery } from './api-keys.graphql.js';
import { DeleteApiKeysBulkAction } from './components/api-key-bulk-actions.js';

export const Route = createFileRoute('/_authenticated/_api-keys/api-keys')({
    component: ApiKeyListPage,
    loader: () => ({ breadcrumb: () => <Trans>API Keys</Trans> }),
});

function ApiKeyListPage() {
    const { t } = useLingui();

    return (
        <ListPage
            pageId="api-key-list"
            emptyStateIllustration={<NoKeysIllustration />}
            listQuery={apiKeyListQuery}
            route={Route}
            title={<Trans>API Keys</Trans>}
            defaultColumnOrder={['name', 'lastUsedAt']}
            defaultVisibility={{
                name: true,
                lastUsedAt: true,
                createdAt: false,
                lookupId: false,
                owner: false,
            }}
            searchPlaceholder={t`Search API keys...`}
            onSearchTermChange={searchTerm => {
                if (searchTerm === '') {
                    return {};
                }
                return {
                    name: { contains: searchTerm },
                };
            }}
            customizeColumns={{
                name: {
                    cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
                },
                lastUsedAt: {
                    header: () => <Trans>Last used</Trans>,
                    cell: ({ row }) => {
                        const lastUsed = row.original.lastUsedAt;
                        if (!lastUsed) {
                            return (
                                <span className="text-muted-foreground">
                                    <Trans>Never</Trans>
                                </span>
                            );
                        }
                        return (
                            <RelativeTime value={lastUsed} />
                        );
                    },
                },
                lookupId: {
                    header: () => <Trans>Lookup ID</Trans>,
                    cell: ({ row }) => <IdentifierDisplay value={row.original.lookupId} />,
                },
                owner: {
                    header: () => <Trans>Created by</Trans>,
                    cell: ({ row }) => row.original.owner?.identifier ?? '',
                },
            }}
            bulkActions={[
                {
                    component: DeleteApiKeysBulkAction,
                },
            ]}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreateApiKey']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon />
                    <Trans>New API Key</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
