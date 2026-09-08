import { defineDashboardExtension } from '@vendure/dashboard';
import { PlugIcon } from 'lucide-react';

import { mcpActivityRoute } from './mcp-activity-route';
import { mcpAuthorizeRoute } from './mcp-authorize-route';
import { mcpGrantsRoute } from './mcp-grants-route';
import { mcpOverviewRoute } from './mcp-overview-route';
import { mcpServerRedirectRoute } from './mcp-server-redirect-route';
import { mcpToolsRoute } from './mcp-tools-route';

defineDashboardExtension({
    navSections: [
        {
            id: 'mcp-server',
            title: 'MCP Server',
            icon: PlugIcon,
            // order 250 lands below the core "System" section, which is at 200.
            placement: 'bottom',
            order: 250,
        },
    ],
    routes: [
        mcpOverviewRoute,
        mcpServerRedirectRoute,
        mcpToolsRoute,
        mcpActivityRoute,
        mcpGrantsRoute,
        mcpAuthorizeRoute,
    ],
});
