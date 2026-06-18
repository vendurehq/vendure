import { Injectable, Type } from '@angular/core';
import { Route } from '@angular/router';
import { map } from 'rxjs/operators';
import { detailComponentWithResolver } from '../../common/base-detail.component';
import { PageLocationId } from '../../common/component-registry-types';
import { CanDeactivateDetailGuard } from '../../shared/providers/routing/can-deactivate-detail-guard';

/**
 * @description
 * The object used to configure a new page tab.
 *
 * @docsCategory tabs
 */
export interface PageTabConfig {
    /**
     * @description
     * A valid location representing a list or detail page.
     */
    location: PageLocationId;
    /**
     * @description
     * An optional icon to display in the tab. The icon
     * should be a valid shape name from the [Clarity Icons](https://core.clarity.design/foundation/icons/shapes/)
     * set.
     */
    tabIcon?: string;
    /**
     * @description
     * The route path to the tab. This will be appended to the
     * route of the parent page.
     */
    route: string;
    /**
     * @description
     * The name of the tab to display in the UI.
     */
    tab: string;
    /**
     * @description
     * The priority of the tab. Tabs with a lower priority will be displayed first.
     */
    priority?: number;
    /**
     * @description
     * The component to render at the route of the tab.
     */
    component: Type<any> | ReturnType<typeof detailComponentWithResolver>;
    /**
     * @description
     * You can optionally provide any native Angular route configuration options here.
     * Any values provided here will take precedence over the values generated
     * by the `route` and `component` properties.
     */
    routeConfig?: Route;
}

@Injectable({
    providedIn: 'root',
})
export class PageService {
    private registry = new Map<PageLocationId, PageTabConfig[]>();

    registerPageTab(config: PageTabConfig) {
        if (!this.registry.has(config.location)) {
            this.registry.set(config.location, []);
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const pages = this.registry.get(config.location)!;
        if (pages.find(p => p.tab === config.tab)) {
            throw new Error(`A page with the tab "${config.tab}" has already been registered`);
        }
        pages.push(config);
    }

    getPageTabRoutes(location: PageLocationId): Route[] {
        const configs = this.registry.get(location) || [];
        return configs.map(config => {
            const route: Route = {
                path: config.route || '',
                pathMatch: config.route ? 'prefix' : 'full',
            };

            let component: Type<any>;
            if (isComponentWithResolver(config.component)) {
                const { component: cmp, breadcrumbFn, resolveFn } = config.component;
                component = cmp;
                route.resolve = { detail: resolveFn };
                route.data = {
                    breadcrumb: data => data.detail.entity.pipe(map(entity => breadcrumbFn(entity))),
                };
            } else {
                component = config.component;
            }
            const guards =
                typeof component.prototype.canDeactivate === 'function' ? [CanDeactivateDetailGuard] : [];
            route.component = component;
            route.canDeactivate = guards;
            if (config.routeConfig) {
                Object.assign(route, config.routeConfig);
            }

            return route;
        });
    }

    getPageTabs(location: PageLocationId): PageTabConfig[] {
        return this.registry.get(location)?.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)) || [];
    }
}

function isComponentWithResolver(input: any): input is ReturnType<typeof detailComponentWithResolver> {
    return input && input.hasOwnProperty('resolveFn');
}
