import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { DeleteApiKeysBulkAction } from './components/api-key-bulk-actions.js';
import { apiKeyListQuery } from './api-keys.graphql.js';

export const Route = createFileRoute('/_authenticated/_api-keys/api-keys')({
    component: ApiKeyListPage,
    loader: () => ({ breadcrumb: () => <Trans>API Keys</Trans> }),
});

function ApiKeyListPage() {
    const { formatRelativeDate } = useLocalFormat();

    return (
        <ListPage
            pageId="api-key-list"
            listQuery={apiKeyListQuery}
            route={Route}
            title={<Trans>API Keys</Trans>}
            defaultVisibility={{
                name: true,
                lastUsedAt: true,
                createdAt: true,
                lookupId: false,
                owner: false,
            }}
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
                            return <span className="text-muted-foreground"><Trans>Never</Trans></span>;
                        }
                        return (
                            <time title={new Date(lastUsed).toLocaleString()}>
                                {formatRelativeDate(new Date(lastUsed))}
                            </time>
                        );
                    },
                },
                lookupId: {
                    header: () => <Trans>Lookup ID</Trans>,
                    cell: ({ row }) => (
                        <code className="font-mono text-xs">{row.original.lookupId}</code>
                    ),
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
