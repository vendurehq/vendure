import { DashboardRouteDefinition } from '@/vdb/framework/extension-api/types';
import { z } from 'zod';

const schema = z.object({
    test: z.string(),
    test2: z.string().optional(),
});

export const routeWithoutAuth: DashboardRouteDefinition = {
    component: route => {
        const search = route.useSearch();
        return <div>Hello from without auth! Test Param from search params: {search.test}</div>;
    },
    validateSearch: search => schema.parse(search),
    path: '/without-auth',
    authenticated: false,
};
