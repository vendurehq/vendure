import { DashboardRouteDefinition, useNavigate } from '@vendure/dashboard';
import { useEffect } from 'react';

function McpServerRedirect() {
    const navigate = useNavigate();
    useEffect(() => {
        void navigate({ to: '/mcp-server/overview', replace: true });
    }, [navigate]);
    return null;
}

export const mcpServerRedirectRoute: DashboardRouteDefinition = {
    path: '/mcp-server',
    component: () => <McpServerRedirect />,
};
