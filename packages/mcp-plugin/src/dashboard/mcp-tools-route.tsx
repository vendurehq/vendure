import { Trans } from '@lingui/react/macro';
import {
    DashboardRouteDefinition,
    Page,
    PageBlock,
    PageLayout,
    PageTitle,
    PermissionGuard,
} from '@vendure/dashboard';

import { ToolsBlock } from './components/tools-block';

export const mcpToolsRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'mcp-server',
        id: 'mcp-server-tools',
        url: '/mcp-server/tools',
        title: 'Tools',
        order: 200,
        requiresPermission: 'ReadMcpServer',
    },
    path: '/mcp-server/tools',
    loader: () => ({ breadcrumb: () => <Trans>Tools</Trans> }),
    component: () => (
        <Page pageId="mcp-server-tools">
            <PageTitle>
                <Trans>Tools</Trans>
            </PageTitle>
            <PermissionGuard requires={['ReadMcpServer']}>
                <PageLayout>
                    <PageBlock column="full" blockId="mcp-tools">
                        <ToolsBlock />
                    </PageBlock>
                </PageLayout>
            </PermissionGuard>
        </Page>
    ),
};
