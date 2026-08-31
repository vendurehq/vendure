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
            // The core "System" section is also at the bottom with order 200, so this
            // section lands just below it.
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
