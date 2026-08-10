import { Trans } from '@lingui/react/macro';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    DashboardRouteDefinition,
    FullWidthPageBlock,
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

/**
 * A full-width section rendered as a Card. `FullWidthPageBlock` itself has no
 * title support, so we supply the card header here for a consistent look.
 */
function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
    return (
        <Card className="@container w-full">
            <CardHeader>
                <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>{children}</CardContent>
        </Card>
    );
}

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
                    <FullWidthPageBlock blockId="mcp-tools">
                        <Section title={<Trans>Tools</Trans>}>
                            <ToolsBlock />
                        </Section>
                    </FullWidthPageBlock>
                    <FullWidthPageBlock blockId="mcp-activity">
                        <Section title={<Trans>Recent activity</Trans>}>
                            <ActivityBlock />
                        </Section>
                    </FullWidthPageBlock>
                    <FullWidthPageBlock blockId="mcp-grants">
                        <Section title={<Trans>OAuth grants</Trans>}>
                            <GrantsBlock />
                        </Section>
                    </FullWidthPageBlock>
                </PageLayout>
            </PermissionGuard>
        </Page>
    ),
};
