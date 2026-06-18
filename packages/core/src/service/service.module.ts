import { Module } from '@nestjs/common';

import { CacheModule } from '../cache/cache.module';
import { ConfigModule } from '../config/config.module';
import { ConnectionModule } from '../connection/connection.module';
import { EventBusModule } from '../event-bus/event-bus.module';
import { JobQueueModule } from '../job-queue/job-queue.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

import { ActiveOrderService } from './helpers/active-order/active-order.service';
import { ConfigArgService } from './helpers/config-arg/config-arg.service';
import { CustomFieldRelationService } from './helpers/custom-field-relation/custom-field-relation.service';
import { EntityDuplicatorService } from './helpers/entity-duplicator/entity-duplicator.service';
import { EntityHydrator } from './helpers/entity-hydrator/entity-hydrator.service';
import { EntitySlugService } from './helpers/entity-slug.service';
import { ExternalAuthenticationService } from './helpers/external-authentication/external-authentication.service';
import { FacetValueChecker } from './helpers/facet-value-checker/facet-value-checker';
import { FulfillmentStateMachine } from './helpers/fulfillment-state-machine/fulfillment-state-machine';
import { ListQueryBuilder } from './helpers/list-query-builder/list-query-builder';
import { LocaleStringHydrator } from './helpers/locale-string-hydrator/locale-string-hydrator';
import { OrderCalculator } from './helpers/order-calculator/order-calculator';
import { OrderMerger } from './helpers/order-merger/order-merger';
import { OrderModifier } from './helpers/order-modifier/order-modifier';
import { OrderSplitter } from './helpers/order-splitter/order-splitter';
import { OrderStateMachine } from './helpers/order-state-machine/order-state-machine';
import { PasswordCipher } from './helpers/password-cipher/password-cipher';
import { PaymentStateMachine } from './helpers/payment-state-machine/payment-state-machine';
import { ProductPriceApplicator } from './helpers/product-price-applicator/product-price-applicator';
import { RefundStateMachine } from './helpers/refund-state-machine/refund-state-machine';
import { RequestContextService } from './helpers/request-context/request-context.service';
import { SettingsStoreService } from './helpers/settings-store/settings-store.service';
import { ShippingCalculator } from './helpers/shipping-calculator/shipping-calculator';
import { SlugValidator } from './helpers/slug-validator/slug-validator';
import { SlugService } from './helpers/slug.service';
import { TranslatableSaver } from './helpers/translatable-saver/translatable-saver';
import { TranslatorService } from './helpers/translator/translator.service';
import { VerificationTokenGenerator } from './helpers/verification-token-generator/verification-token-generator';
import { InitializerService } from './initializer.service';
import { AdministratorService } from './services/administrator.service';
import { ApiKeyService } from './services/api-key.service';
import { AssetService } from './services/asset.service';
import { AuthService } from './services/auth.service';
import { ChannelService } from './services/channel.service';
import { CollectionService } from './services/collection.service';
import { CountryService } from './services/country.service';
import { CustomerGroupService } from './services/customer-group.service';
import { CustomerService } from './services/customer.service';
import { FacetValueService } from './services/facet-value.service';
import { FacetService } from './services/facet.service';
import { FulfillmentService } from './services/fulfillment.service';
import { GlobalSettingsService } from './services/global-settings.service';
import { HistoryService } from './services/history.service';
import { OrderTestingService } from './services/order-testing.service';
import { OrderService } from './services/order.service';
import { PaymentMethodService } from './services/payment-method.service';
import { PaymentService } from './services/payment.service';
import { ProductOptionGroupService } from './services/product-option-group.service';
import { ProductOptionService } from './services/product-option.service';
import { ProductVariantService } from './services/product-variant.service';
import { ProductService } from './services/product.service';
import { PromotionService } from './services/promotion.service';
import { RoleService } from './services/role.service';
import { SearchService } from './services/search.service';
import { SellerService } from './services/seller.service';
import { SessionService } from './services/session.service';
import { ShippingMethodService } from './services/shipping-method.service';
import { StockLevelService } from './services/stock-level.service';
import { StockLocationService } from './services/stock-location.service';
import { StockMovementService } from './services/stock-movement.service';
import { TagService } from './services/tag.service';
import { TaxCategoryService } from './services/tax-category.service';
import { TaxRateService } from './services/tax-rate.service';
import { UserService } from './services/user.service';
import { ZoneService } from './services/zone.service';

const services = [
    AdministratorService,
    ApiKeyService,
    AssetService,
    AuthService,
    ChannelService,
    CollectionService,
    CountryService,
    CustomerGroupService,
    CustomerService,
    EntitySlugService,
    FacetService,
    FacetValueService,
    FulfillmentService,
    GlobalSettingsService,
    HistoryService,
    OrderService,
    OrderTestingService,
    PaymentService,
    PaymentMethodService,
    ProductOptionGroupService,
    ProductOptionService,
    ProductService,
    ProductVariantService,
    PromotionService,
    RoleService,
    SearchService,
    SellerService,
    SessionService,
    ShippingMethodService,
    SlugService,
    StockLevelService,
    StockLocationService,
    StockMovementService,
    TagService,
    TaxCategoryService,
    TaxRateService,
    UserService,
    ZoneService,
];

const helpers = [
    TranslatableSaver,
    PasswordCipher,
    OrderCalculator,
    OrderStateMachine,
    FulfillmentStateMachine,
    OrderMerger,
    OrderModifier,
    OrderSplitter,
    PaymentStateMachine,
    ListQueryBuilder,
    ShippingCalculator,
    VerificationTokenGenerator,
    RefundStateMachine,
    ConfigArgService,
    SlugValidator,
    ExternalAuthenticationService,
    CustomFieldRelationService,
    LocaleStringHydrator,
    ActiveOrderService,
    ProductPriceApplicator,
    EntityHydrator,
    RequestContextService,
    TranslatorService,
    EntityDuplicatorService,
    FacetValueChecker,
    SettingsStoreService,
];

/**
 * The ServiceCoreModule is imported internally by the ServiceModule. It is arranged in this way so that
 * there is only a single instance of this module being instantiated, and thus the lifecycle hooks will
 * only run a single time.
 */
@Module({
    imports: [ConnectionModule, ConfigModule, EventBusModule, CacheModule, JobQueueModule, SchedulerModule],
    providers: [...services, ...helpers, InitializerService],
    exports: [...services, ...helpers],
})
export class ServiceCoreModule {}

/**
 * The ServiceModule is responsible for the service layer, i.e. accessing the database
 * and implementing the main business logic of the application.
 *
 * The exported providers are used in the ApiModule, which is responsible for parsing requests
 * into a format suitable for the service layer logic.
 */
@Module({
    imports: [ServiceCoreModule],
    exports: [ServiceCoreModule],
})
export class ServiceModule {}
