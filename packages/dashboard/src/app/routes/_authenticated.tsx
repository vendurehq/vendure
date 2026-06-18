import { AppLayout } from '@/vdb/components/layout/app-layout.js';
import { useAuth } from '@/vdb/hooks/use-auth.js';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';

// Must be a string literal to satisfy @tanstack/router-generator static analysis.
// Keep in sync with AUTHENTICATED_ROUTE_PREFIX in @/vdb/constants.js.
export const Route = createFileRoute('/_authenticated')({
    beforeLoad: ({ context, location }) => {
        if (!context.auth.isAuthenticated) {
            throw redirect({
                to: '/login',
                search: {
                    redirect: location.href,
                },
            });
        }
    },
    loader: () => ({
        breadcrumb: 'Insights',
    }),
    component: AuthLayout,
});

function AuthLayout() {
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();

    if (!isAuthenticated) {
        navigate({
            to: '/login',
        });
        return <></>;
    }

    return <AppLayout />;
}
