import { Directive, Injector, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { of, Subscription } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

import { Permission } from '../../common/generated-types';
import { DataService } from '../../data/providers/data.service';
import { HealthCheckService } from '../../providers/health-check/health-check.service';
import { JobQueueService } from '../../providers/job-queue/job-queue.service';
import { ActionBarContext, NavMenuBadge, NavMenuItem } from '../../providers/nav-builder/nav-builder-types';
import { NavBuilderService } from '../../providers/nav-builder/nav-builder.service';
import { NotificationService } from '../../providers/notification/notification.service';

@Directive({
    selector: '[vdrBaseNav]',
    standalone: false,
})
// eslint-disable-next-line @angular-eslint/directive-class-suffix
export class BaseNavComponent implements OnInit, OnDestroy {
    constructor(
        protected route: ActivatedRoute,
        protected router: Router,
        public navBuilderService: NavBuilderService,
        protected healthCheckService: HealthCheckService,
        protected jobQueueService: JobQueueService,
        protected dataService: DataService,
        protected notificationService: NotificationService,
        protected injector: Injector,
    ) {}

    private userPermissions: string[];
    private subscription: Subscription;

    shouldDisplayLink(menuItem: Pick<NavMenuItem, 'requiresPermission'>) {
        if (!this.userPermissions) {
            return false;
        }
        if (!menuItem.requiresPermission) {
            return true;
        }
        if (typeof menuItem.requiresPermission === 'string') {
            return this.userPermissions.includes(menuItem.requiresPermission);
        }
        if (typeof menuItem.requiresPermission === 'function') {
            return menuItem.requiresPermission(this.userPermissions);
        }
    }

    ngOnInit(): void {
        this.defineNavMenu();
        this.subscription = this.dataService.client
            .userStatus()
            .mapStream(({ userStatus }) => {
                this.userPermissions = userStatus.permissions;
            })
            .subscribe();
    }

    ngOnDestroy() {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
    }

    getRouterLink(item: NavMenuItem) {
        return this.navBuilderService.getRouterLink(
            { routerLink: item.routerLink, context: this.createContext() },
            this.route,
        );
    }

    private defineNavMenu() {
        function allow(...permissions: string[]): (userPermissions: string[]) => boolean {
            return userPermissions => {
                for (const permission of permissions) {
                    if (userPermissions.includes(permission)) {
                        return true;
                    }
                }
                return false;
            };
        }

        this.navBuilderService.defineNavMenuSections([
            {
                requiresPermission: allow(
                    Permission.ReadCatalog,
                    Permission.ReadProduct,
                    Permission.ReadFacet,
                    Permission.ReadCollection,
                    Permission.ReadAsset,
                ),
                id: 'catalog',
                label: _('nav.catalog'),
                items: [
                    {
                        requiresPermission: allow(Permission.ReadCatalog, Permission.ReadProduct),
                        id: 'products',
                        label: _('nav.products'),
                        icon: 'library',
                        routerLink: ['/catalog', 'products'],
                    },
                    {
                        requiresPermission: allow(Permission.ReadCatalog, Permission.ReadFacet),
                        id: 'facets',
                        label: _('nav.facets'),
                        icon: 'tag',
                        routerLink: ['/catalog', 'facets'],
                    },
                    {
                        requiresPermission: allow(Permission.ReadCatalog, Permission.ReadCollection),
                        id: 'collections',
                        label: _('nav.collections'),
                        icon: 'folder-open',
                        routerLink: ['/catalog', 'collections'],
                    },
                    {
                        requiresPermission: allow(Permission.ReadCatalog, Permission.ReadAsset),
                        id: 'assets',
                        label: _('nav.assets'),
                        icon: 'image-gallery',
                        routerLink: ['/catalog', 'assets'],
                    },
                ],
            },
            {
                id: 'sales',
                label: _('nav.sales'),
                requiresPermission: allow(Permission.ReadOrder),
                items: [
                    {
                        requiresPermission: allow(Permission.ReadOrder),
                        id: 'orders',
                        label: _('nav.orders'),
                        routerLink: ['/orders'],
                        icon: 'shopping-cart',
                    },
                ],
            },
            {
                id: 'customers',
                label: _('nav.customers'),
                requiresPermission: allow(Permission.ReadCustomer, Permission.ReadCustomerGroup),
                items: [
                    {
                        requiresPermission: allow(Permission.ReadCustomer),
                        id: 'customers',
                        label: _('nav.customers'),
                        routerLink: ['/customer', 'customers'],
                        icon: 'user',
                    },
                    {
                        requiresPermission: allow(Permission.ReadCustomerGroup),
                        id: 'customer-groups',
                        label: _('nav.customer-groups'),
                        routerLink: ['/customer', 'groups'],
                        icon: 'users',
                    },
                ],
            },
            {
                id: 'marketing',
                label: _('nav.marketing'),
                requiresPermission: allow(Permission.ReadPromotion),
                items: [
                    {
                        requiresPermission: allow(Permission.ReadPromotion),
                        id: 'promotions',
                        label: _('nav.promotions'),
                        routerLink: ['/marketing', 'promotions'],
                        icon: 'asterisk',
                    },
                ],
            },
            {
                id: 'settings',
                label: _('nav.settings'),
                icon: 'cog',
                displayMode: 'settings',
                requiresPermission: allow(
                    Permission.ReadSettings,
                    Permission.ReadChannel,
                    Permission.ReadAdministrator,
                    Permission.ReadShippingMethod,
                    Permission.ReadPaymentMethod,
                    Permission.ReadTaxCategory,
                    Permission.ReadTaxRate,
                    Permission.ReadCountry,
                    Permission.ReadZone,
                    Permission.UpdateGlobalSettings,
                ),
                collapsible: true,
                collapsedByDefault: true,
                items: [
                    {
                        requiresPermission: allow(Permission.ReadSeller),
                        id: 'sellers',
                        label: _('nav.sellers'),
                        routerLink: ['/settings', 'sellers'],
                        icon: 'store',
                    },
                    {
                        requiresPermission: allow(Permission.ReadChannel),
                        id: 'channels',
                        label: _('nav.channels'),
                        routerLink: ['/settings', 'channels'],
                        icon: 'layers',
                    },
                    {
                        requiresPermission: allow(Permission.ReadStockLocation),
                        id: 'stock-locations',
                        label: _('nav.stock-locations'),
                        icon: 'map-marker',
                        routerLink: ['/settings', 'stock-locations'],
                    },
                    {
                        requiresPermission: allow(Permission.ReadAdministrator),
                        id: 'administrators',
                        label: _('nav.administrators'),
                        routerLink: ['/settings', 'administrators'],
                        icon: 'administrator',
                    },
                    {
                        requiresPermission: allow(Permission.ReadAdministrator),
                        id: 'roles',
                        label: _('nav.roles'),
                        routerLink: ['/settings', 'roles'],
                        icon: 'users',
                    },
                    {
                        requiresPermission: allow(Permission.ReadShippingMethod),
                        id: 'shipping-methods',
                        label: _('nav.shipping-methods'),
                        routerLink: ['/settings', 'shipping-methods'],
                        icon: 'truck',
                    },
                    {
                        requiresPermission: allow(Permission.ReadPaymentMethod),
                        id: 'payment-methods',
                        label: _('nav.payment-methods'),
                        routerLink: ['/settings', 'payment-methods'],
                        icon: 'credit-card',
                    },
                    {
                        requiresPermission: allow(Permission.ReadTaxCategory),
                        id: 'tax-categories',
                        label: _('nav.tax-categories'),
                        routerLink: ['/settings', 'tax-categories'],
                        icon: 'view-list',
                    },
                    {
                        requiresPermission: allow(Permission.ReadTaxRate),
                        id: 'tax-rates',
                        label: _('nav.tax-rates'),
                        routerLink: ['/settings', 'tax-rates'],
                        icon: 'calculator',
                    },
                    {
                        requiresPermission: allow(Permission.ReadCountry),
                        id: 'countries',
                        label: _('nav.countries'),
                        routerLink: ['/settings', 'countries'],
                        icon: 'flag',
                    },
                    {
                        requiresPermission: allow(Permission.ReadZone),
                        id: 'zones',
                        label: _('nav.zones'),
                        routerLink: ['/settings', 'zones'],
                        icon: 'world',
                    },
                    {
                        requiresPermission: allow(Permission.UpdateGlobalSettings),
                        id: 'global-settings',
                        label: _('nav.global-settings'),
                        routerLink: ['/settings', 'global-settings'],
                        icon: 'cog',
                    },
                ],
            },
            {
                id: 'system',
                label: _('nav.system'),
                icon: 'computer',
                displayMode: 'settings',
                requiresPermission: Permission.ReadSystem,
                collapsible: true,
                collapsedByDefault: true,
                items: [
                    {
                        id: 'job-queue',
                        label: _('nav.job-queue'),
                        routerLink: ['/system', 'jobs'],
                        icon: 'tick-chart',
                        statusBadge: this.jobQueueService.activeJobs$.pipe(
                            startWith([]),
                            map(
                                jobs =>
                                    ({
                                        type: jobs.length === 0 ? 'none' : 'info',
                                        propagateToSection: jobs.length > 0,
                                    }) as NavMenuBadge,
                            ),
                        ),
                    },
                    {
                        id: 'system-status',
                        label: _('nav.system-status'),
                        routerLink: ['/system', 'system-status'],
                        icon: 'rack-server',
                        statusBadge: this.healthCheckService.status$.pipe(
                            map(status => ({
                                type: status === 'ok' ? 'success' : 'error',
                                propagateToSection: status === 'error',
                            })),
                        ),
                    },
                    {
                        id: 'scheduled-tasks',
                        label: _('nav.scheduled-tasks'),
                        routerLink: ['/system', 'scheduled-tasks'],
                        icon: 'clock',
                    },
                ],
            },
        ]);
    }

    private createContext(): ActionBarContext {
        return {
            route: this.route,
            injector: this.injector,
            dataService: this.dataService,
            notificationService: this.notificationService,
            entity$: of(undefined),
        };
    }
}
