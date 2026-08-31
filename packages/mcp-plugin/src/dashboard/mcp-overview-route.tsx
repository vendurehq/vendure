import { Trans } from '@lingui/react/macro';
import {
    ActionBarItem,
    DashboardRouteDefinition,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
    PermissionGuard,
} from '@vendure/dashboard';

import { ConnectionDialog } from './components/connection-block';
import { StatsBlock } from './components/stats-block';

export const mcpOverviewRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'mcp-server',
        id: 'mcp-server-overview',
        url: '/mcp-server/overview',
        title: 'Overview',
        order: 100,
        requiresPermission: 'ReadMcpServer',
    },
    path: '/mcp-server/overview',
    loader: () => ({ breadcrumb: () => <Trans>Overview</Trans> }),
    component: () => (
        <Page pageId="mcp-server-overview">
            <PageTitle>
                <Trans>MCP Server</Trans>
            </PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="mcp-connect-client">
                    <ConnectionDialog />
                </ActionBarItem>
            </PageActionBar>
            <PermissionGuard requires={['ReadMcpServer']}>
                <PageLayout>
                    <PageBlock column="full" blockId="mcp-stats" title={<Trans>Health & usage</Trans>}>
                        <StatsBlock />
                    </PageBlock>
                </PageLayout>
            </PermissionGuard>
        </Page>
    ),
};
