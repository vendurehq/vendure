import { Trans } from '@lingui/react/macro';
import {
    DashboardRouteDefinition,
    Page,
    PageBlock,
    PageLayout,
    PageTitle,
    PermissionGuard,
} from '@vendure/dashboard';

import { GrantsBlock } from './components/grants-block';

export const mcpGrantsRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'mcp-server',
        id: 'mcp-server-grants',
        url: '/mcp-server/grants',
        title: 'Grants',
        order: 400,
        requiresPermission: 'ReadMcpServer',
    },
    path: '/mcp-server/grants',
    loader: () => ({ breadcrumb: () => <Trans>Grants</Trans> }),
    component: () => (
        <Page pageId="mcp-server-grants">
            <PageTitle>
                <Trans>Grants</Trans>
            </PageTitle>
            <PermissionGuard requires={['ReadMcpServer']}>
                <PageLayout>
                    <PageBlock column="full" blockId="mcp-grants">
                        <GrantsBlock />
                    </PageBlock>
                </PageLayout>
            </PermissionGuard>
        </Page>
    ),
};
