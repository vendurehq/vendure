export const DASHBOARD_API_PORT_FROM_PAGE = 'auto';

export function resolveDevelopmentNetwork({ mode, ensurePortlessProxy, getPortlessUrl }) {
    const usePortless = mode !== 'direct';
    if (usePortless) {
        ensurePortlessProxy();
    }
    const apiOrigin = usePortless ? getPortlessUrl('vendure') : 'http://localhost:3000';
    const dashboardOrigin = usePortless ? getPortlessUrl('dashboard.vendure') : 'http://localhost:5173';
    const dashboardUrl = `${dashboardOrigin}/dashboard`;
    const apiUrl = new URL(apiOrigin);

    return {
        usePortless,
        apiOrigin,
        dashboardOrigin,
        dashboardUrl,
        serverDashboardUrl: `${apiOrigin}/dashboard/`,
        sharedEnv: {
            VENDURE_DASHBOARD_URL: dashboardUrl,
            VITE_ADMIN_API_HOST: usePortless ? `${apiUrl.protocol}//${apiUrl.hostname}` : 'http://localhost',
            VITE_ADMIN_API_PORT: usePortless ? DASHBOARD_API_PORT_FROM_PAGE : '3000',
            ...(usePortless ? { VENDURE_TRUST_PROXY: 'true' } : {}),
        },
        serverEnv: usePortless ? {} : { API_PORT: '3000', PORT: '3000' },
        dashboardEnv: usePortless ? {} : { API_PORT: '3000', PORT: '5173' },
    };
}
