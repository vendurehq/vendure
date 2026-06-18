import { AuthContext } from '@/vdb/providers/auth.js';
import { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet } from '@tanstack/react-router';
import { usePageTitle } from '../common/use-page-title.js';

export interface MyRouterContext {
    auth: AuthContext;
    queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
    component: RootComponent,
});

function RootComponent() {
    document.title = usePageTitle();
    return (
        <>
            <HeadContent />
            <Outlet />
        </>
    );
}
