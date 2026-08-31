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

import { ActivityBlock } from './components/activity-block';
import { ConnectionDialog } from './components/connection-block';
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
            <PageActionBar>
                <ActionBarItem itemId="mcp-connect-client">
                    <ConnectionDialog />
                </ActionBarItem>
            </PageActionBar>
            <PermissionGuard requires={['ReadMcpServer']}>
                {/* Every block is full width. The layout renders full-width blocks above
                    main/side ones, so mixing the two would push Health & usage below the long
                    tables no matter where they are written here. */}
                <PageLayout>
                    <PageBlock column="full" blockId="mcp-stats" title={<Trans>Health & usage</Trans>}>
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
