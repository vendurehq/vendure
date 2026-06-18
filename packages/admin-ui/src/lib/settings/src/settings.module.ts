import { NgModule } from '@angular/core';
import { RouterModule, ROUTES } from '@angular/router';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    BulkActionRegistryService,
    detailComponentWithResolver,
    GetAdministratorDetailDocument,
    GetChannelDetailDocument,
    GetCountryDetailDocument,
    GetPaymentMethodDetailDocument,
    GetRoleDetailDocument,
    GetSellerDetailDocument,
    GetShippingMethodDetailDocument,
    GetStockLocationDetailDocument,
    GetTaxCategoryDetailDocument,
    GetTaxRateDetailDocument,
    GetZoneDetailDocument,
    PageService,
    SharedModule,
} from '@vendure/admin-ui/core';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';

import { AddCountryToZoneDialogComponent } from './components/add-country-to-zone-dialog/add-country-to-zone-dialog.component';
import { AdminDetailComponent } from './components/admin-detail/admin-detail.component';
import { deleteAdministratorsBulkAction } from './components/administrator-list/administrator-list-bulk-actions';
import { AdministratorListComponent } from './components/administrator-list/administrator-list.component';
import { ChannelDetailComponent } from './components/channel-detail/channel-detail.component';
import { deleteChannelsBulkAction } from './components/channel-list/channel-list-bulk-actions';
import { ChannelListComponent } from './components/channel-list/channel-list.component';
import { CountryDetailComponent } from './components/country-detail/country-detail.component';
import { deleteCountriesBulkAction } from './components/country-list/country-list-bulk-actions';
import { CountryListComponent } from './components/country-list/country-list.component';
import { GlobalSettingsComponent } from './components/global-settings/global-settings.component';
import { PaymentMethodDetailComponent } from './components/payment-method-detail/payment-method-detail.component';
import {
    assignPaymentMethodsToChannelBulkAction,
    deletePaymentMethodsBulkAction,
    removePaymentMethodsFromChannelBulkAction,
} from './components/payment-method-list/payment-method-list-bulk-actions';
import { PaymentMethodListComponent } from './components/payment-method-list/payment-method-list.component';
import { PermissionGridComponent } from './components/permission-grid/permission-grid.component';
import { ProfileComponent } from './components/profile/profile.component';
import { RoleDetailComponent } from './components/role-detail/role-detail.component';
import { deleteRolesBulkAction } from './components/role-list/role-list-bulk-actions';
import { RoleListComponent } from './components/role-list/role-list.component';
import { SellerDetailComponent } from './components/seller-detail/seller-detail.component';
import { deleteSellersBulkAction } from './components/seller-list/seller-list-bulk-actions';
import { SellerListComponent } from './components/seller-list/seller-list.component';
import { ShippingEligibilityTestResultComponent } from './components/shipping-eligibility-test-result/shipping-eligibility-test-result.component';
import { ShippingMethodDetailComponent } from './components/shipping-method-detail/shipping-method-detail.component';
import {
    assignShippingMethodsToChannelBulkAction,
    deleteShippingMethodsBulkAction,
    removeShippingMethodsFromChannelBulkAction,
} from './components/shipping-method-list/shipping-method-list-bulk-actions';
import { ShippingMethodListComponent } from './components/shipping-method-list/shipping-method-list.component';
import { ShippingMethodTestResultComponent } from './components/shipping-method-test-result/shipping-method-test-result.component';
import { StockLocationDetailComponent } from './components/stock-location-detail/stock-location-detail.component';
import {
    assignStockLocationsToChannelBulkAction,
    deleteStockLocationsBulkAction,
    removeStockLocationsFromChannelBulkAction,
} from './components/stock-location-list/stock-location-list-bulk-actions';
import { StockLocationListComponent } from './components/stock-location-list/stock-location-list.component';
import { TaxCategoryDetailComponent } from './components/tax-category-detail/tax-category-detail.component';
import { deleteTaxCategoriesBulkAction } from './components/tax-category-list/tax-category-list-bulk-actions';
import { TaxCategoryListComponent } from './components/tax-category-list/tax-category-list.component';
import { TaxRateDetailComponent } from './components/tax-rate-detail/tax-rate-detail.component';
import { deleteTaxRatesBulkAction } from './components/tax-rate-list/tax-rate-list-bulk-actions';
import { TaxRateListComponent } from './components/tax-rate-list/tax-rate-list.component';
import { TestAddressFormComponent } from './components/test-address-form/test-address-form.component';
import { TestOrderBuilderComponent } from './components/test-order-builder/test-order-builder.component';
import { TestShippingMethodsComponent } from './components/test-shipping-methods/test-shipping-methods.component';
import { ZoneDetailComponent } from './components/zone-detail/zone-detail.component';
import { deleteZonesBulkAction } from './components/zone-list/zone-list-bulk-actions';
import { ZoneListComponent } from './components/zone-list/zone-list.component';
import { ZoneMemberControlsDirective } from './components/zone-member-list/zone-member-controls.directive';
import { removeZoneMembersBulkAction } from './components/zone-member-list/zone-member-list-bulk-actions';
import { ZoneMemberListHeaderDirective } from './components/zone-member-list/zone-member-list-header.directive';
import { ZoneMemberListComponent } from './components/zone-member-list/zone-member-list.component';
import { createRoutes } from './settings.routes';

@NgModule({
    imports: [SharedModule, RouterModule.forChild([])],
    providers: [
        {
            provide: ROUTES,
            useFactory: (pageService: PageService) => createRoutes(pageService),
            multi: true,
            deps: [PageService],
        },
    ],
    declarations: [
        TaxCategoryListComponent,
        TaxCategoryDetailComponent,
        AdministratorListComponent,
        RoleListComponent,
        RoleDetailComponent,
        AdminDetailComponent,
        PermissionGridComponent,
        CountryListComponent,
        CountryDetailComponent,
        TaxRateListComponent,
        TaxRateDetailComponent,
        ChannelListComponent,
        ChannelDetailComponent,
        ShippingMethodListComponent,
        ShippingMethodDetailComponent,
        PaymentMethodListComponent,
        PaymentMethodDetailComponent,
        GlobalSettingsComponent,
        TestOrderBuilderComponent,
        TestAddressFormComponent,
        SellerDetailComponent,
        SellerListComponent,
        ShippingMethodTestResultComponent,
        ShippingEligibilityTestResultComponent,
        ZoneListComponent,
        AddCountryToZoneDialogComponent,
        ZoneMemberListComponent,
        ZoneMemberListHeaderDirective,
        ZoneMemberControlsDirective,
        ProfileComponent,
        TestShippingMethodsComponent,
        ZoneDetailComponent,
        StockLocationListComponent,
        StockLocationDetailComponent,
    ],
})
export class SettingsModule {
    private static hasRegisteredTabsAndBulkActions = false;

    constructor(bulkActionRegistryService: BulkActionRegistryService, pageService: PageService) {
        if (SettingsModule.hasRegisteredTabsAndBulkActions) {
            return;
        }
        bulkActionRegistryService.registerBulkAction(deleteSellersBulkAction);

        bulkActionRegistryService.registerBulkAction(deleteChannelsBulkAction);

        bulkActionRegistryService.registerBulkAction(deleteAdministratorsBulkAction);

        bulkActionRegistryService.registerBulkAction(deleteRolesBulkAction);

        bulkActionRegistryService.registerBulkAction(assignShippingMethodsToChannelBulkAction);
        bulkActionRegistryService.registerBulkAction(removeShippingMethodsFromChannelBulkAction);
        bulkActionRegistryService.registerBulkAction(deleteShippingMethodsBulkAction);

        bulkActionRegistryService.registerBulkAction(assignPaymentMethodsToChannelBulkAction);
        bulkActionRegistryService.registerBulkAction(removePaymentMethodsFromChannelBulkAction);
        bulkActionRegistryService.registerBulkAction(deletePaymentMethodsBulkAction);

        bulkActionRegistryService.registerBulkAction(deleteTaxCategoriesBulkAction);

        bulkActionRegistryService.registerBulkAction(deleteTaxRatesBulkAction);

        bulkActionRegistryService.registerBulkAction(deleteCountriesBulkAction);

        bulkActionRegistryService.registerBulkAction(deleteZonesBulkAction);

        bulkActionRegistryService.registerBulkAction(removeZoneMembersBulkAction);

        bulkActionRegistryService.registerBulkAction(assignStockLocationsToChannelBulkAction);
        bulkActionRegistryService.registerBulkAction(removeStockLocationsFromChannelBulkAction);
        bulkActionRegistryService.registerBulkAction(deleteStockLocationsBulkAction);

        pageService.registerPageTab({
            priority: 0,
            location: 'seller-list',
            tab: _('breadcrumb.sellers'),
            route: '',
            component: SellerListComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'seller-detail',
            tab: _('settings.seller'),
            route: '',
            component: detailComponentWithResolver({
                component: SellerDetailComponent,
                query: GetSellerDetailDocument,
                entityKey: 'seller',
                getBreadcrumbs: entity => [
                    {
                        label: entity ? entity.name : _('settings.create-new-seller'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'channel-list',
            tab: _('breadcrumb.channels'),
            route: '',
            component: ChannelListComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'channel-detail',
            tab: _('settings.channel'),
            route: '',
            component: detailComponentWithResolver({
                component: ChannelDetailComponent,
                query: GetChannelDetailDocument,
                entityKey: 'channel',
                getBreadcrumbs: entity => [
                    {
                        label: entity
                            ? entity.code === DEFAULT_CHANNEL_CODE
                                ? 'common.default-channel'
                                : entity.code
                            : _('settings.create-new-channel'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'administrator-list',
            tab: _('breadcrumb.administrators'),
            route: '',
            component: AdministratorListComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'administrator-detail',
            tab: _('settings.administrator'),
            route: '',
            component: detailComponentWithResolver({
                component: AdminDetailComponent,
                query: GetAdministratorDetailDocument,
                entityKey: 'administrator',
                getBreadcrumbs: entity => [
                    {
                        label: entity
                            ? `${entity.firstName} ${entity.lastName}`
                            : _('admin.create-new-administrator'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'role-list',
            tab: _('breadcrumb.roles'),
            route: '',
            component: RoleListComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'role-detail',
            tab: _('settings.role'),
            route: '',
            component: detailComponentWithResolver({
                component: RoleDetailComponent,
                query: GetRoleDetailDocument,
                entityKey: 'role',
                getBreadcrumbs: entity => [
                    {
                        label: entity ? entity.description : _('settings.create-new-role'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'shipping-method-list',
            tab: _('breadcrumb.shipping-methods'),
            route: '',
            component: ShippingMethodListComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'shipping-method-detail',
            tab: _('settings.shipping-method'),
            route: '',
            component: detailComponentWithResolver({
                component: ShippingMethodDetailComponent,
                query: GetShippingMethodDetailDocument,
                entityKey: 'shippingMethod',
                getBreadcrumbs: entity => [
                    {
                        label: entity ? entity.name : _('settings.create-new-shipping-method'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'shipping-method-list',
            tab: _('settings.test-shipping-methods'),
            route: 'test',
            component: TestShippingMethodsComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'payment-method-list',
            tab: _('breadcrumb.payment-methods'),
            route: '',
            component: PaymentMethodListComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'payment-method-detail',
            tab: _('settings.payment-method'),
            route: '',
            component: detailComponentWithResolver({
                component: PaymentMethodDetailComponent,
                query: GetPaymentMethodDetailDocument,
                entityKey: 'paymentMethod',
                getBreadcrumbs: entity => [
                    {
                        label: entity ? entity.name : _('settings.create-new-payment-method'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'tax-category-list',
            tab: _('breadcrumb.tax-categories'),
            route: '',
            component: TaxCategoryListComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'tax-category-detail',
            tab: _('settings.tax-category'),
            route: '',
            component: detailComponentWithResolver({
                component: TaxCategoryDetailComponent,
                query: GetTaxCategoryDetailDocument,
                entityKey: 'taxCategory',
                getBreadcrumbs: entity => [
                    {
                        label: entity ? entity.name : _('settings.create-new-tax-category'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'tax-rate-list',
            tab: _('breadcrumb.tax-rates'),
            route: '',
            component: TaxRateListComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'tax-rate-detail',
            tab: _('settings.tax-rate'),
            route: '',
            component: detailComponentWithResolver({
                component: TaxRateDetailComponent,
                query: GetTaxRateDetailDocument,
                entityKey: 'taxRate',
                getBreadcrumbs: entity => [
                    {
                        label: entity ? entity.name : _('settings.create-new-tax-rate'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'country-list',
            tab: _('breadcrumb.countries'),
            route: '',
            component: CountryListComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'country-detail',
            tab: _('settings.country'),
            route: '',
            component: detailComponentWithResolver({
                component: CountryDetailComponent,
                query: GetCountryDetailDocument,
                entityKey: 'country',
                getBreadcrumbs: entity => [
                    {
                        label: entity ? entity.name : _('settings.create-new-country'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'zone-list',
            tab: _('breadcrumb.zones'),
            route: '',
            component: ZoneListComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'zone-detail',
            tab: _('settings.zone'),
            route: '',
            component: detailComponentWithResolver({
                component: ZoneDetailComponent,
                query: GetZoneDetailDocument,
                entityKey: 'zone',
                getBreadcrumbs: entity => [
                    {
                        label: entity ? entity.name : _('settings.create-new-zone'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'global-setting-detail',
            tab: _('breadcrumb.global-settings'),
            route: '',
            component: GlobalSettingsComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'profile',
            tab: _('breadcrumb.profile'),
            route: '',
            component: ProfileComponent,
        });

        pageService.registerPageTab({
            priority: 0,
            location: 'stock-location-list',
            tab: _('catalog.stock-locations'),
            route: '',
            component: StockLocationListComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'stock-location-detail',
            tab: _('catalog.stock-location'),
            route: '',
            component: detailComponentWithResolver({
                component: StockLocationDetailComponent,
                query: GetStockLocationDetailDocument,
                entityKey: 'stockLocation',
                getBreadcrumbs: entity => [
                    {
                        label: entity ? entity.name : _('catalog.create-new-stock-location'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        SettingsModule.hasRegisteredTabsAndBulkActions = true;
    }
}
