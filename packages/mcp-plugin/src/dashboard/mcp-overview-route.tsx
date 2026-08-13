import { Trans } from '@lingui/react/macro';
import {
    DashboardRouteDefinition,
    Page,
    PageBlock,
    PageLayout,
    PageTitle,
    PermissionGuard,
} from '@vendure/dashboard';

import { ActivityBlock } from './components/activity-block';
import { ConnectionBlock } from './components/connection-block';
import { GrantsBlock } from './components/grants-block';
import { StatsBlock } from './components/stats-block';
import { ToolsBlock } from './components/tools-block';

export const mcpOverviewRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'system',
        id: 'mcp-server',
        url: '/mcp-server',
        title: 'MCP Server',
        requiresPermission: 'ReadMcpServer',
    },
    path: '/mcp-server',
    loader: () => ({ breadcrumb: () => <Trans>MCP Server</Trans> }),
    component: () => (
        <Page pageId="mcp-server-overview">
            <PageTitle>
                <Trans>MCP Server</Trans>
            </PageTitle>
            <PermissionGuard requires={['ReadMcpServer']}>
                <PageLayout>
                    <PageBlock column="main" blockId="mcp-connection" title={<Trans>Connection</Trans>}>
                        <ConnectionBlock />
                    </PageBlock>
                    <PageBlock column="side" blockId="mcp-stats" title={<Trans>Health & usage</Trans>}>
                        <StatsBlock />
                    </PageBlock>
                    <PageBlock column="full" blockId="mcp-tools" title={<Trans>Tools</Trans>}>
                        <ToolsBlock />
                    </PageBlock>
                    <PageBlock column="full" blockId="mcp-activity" title={<Trans>Recent activity</Trans>}>
                        <ActivityBlock />
                    </PageBlock>
                    <PageBlock column="full" blockId="mcp-grants" title={<Trans>OAuth grants</Trans>}>
                        <GrantsBlock />
                    </PageBlock>
                </PageLayout>
            </PermissionGuard>
        </Page>
    ),
};
