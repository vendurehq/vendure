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

export const mcpActivityRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'mcp-server',
        id: 'mcp-server-activity',
        url: '/mcp-server/activity',
        title: 'Activity',
        order: 300,
        requiresPermission: 'ReadMcpServer',
    },
    path: '/mcp-server/activity',
    loader: () => ({ breadcrumb: () => <Trans>Activity</Trans> }),
    component: () => (
        <Page pageId="mcp-server-activity">
            <PageTitle>
                <Trans>Activity</Trans>
            </PageTitle>
            <PermissionGuard requires={['ReadMcpServer']}>
                <PageLayout>
                    <PageBlock column="full" blockId="mcp-activity">
                        <ActivityBlock />
                    </PageBlock>
                </PageLayout>
            </PermissionGuard>
        </Page>
    ),
};
