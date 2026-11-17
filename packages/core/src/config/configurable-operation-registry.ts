import type { ConfigurableOperationDefType } from '../common/configurable-operation';
import type { CollectionFilter } from './catalog/collection-filter';
import type { ConfigService } from './config.service';
import type { EntityDuplicator } from './entity/entity-duplicator';
import type { FulfillmentHandler } from './fulfillment/fulfillment-handler';
import type { PaymentMethodEligibilityChecker } from './payment/payment-method-eligibility-checker';
import type { PaymentMethodHandler } from './payment/payment-method-handler';
import type { PromotionAction } from './promotion/promotion-action';
import type { PromotionCondition } from './promotion/promotion-condition';
import type { ShippingCalculator } from './shipping-method/shipping-calculator';
import type { ShippingEligibilityChecker } from './shipping-method/shipping-eligibility-checker';

/**
 * Maps each configurable-operation type name to its definition type.
 */
export type ConfigDefTypeMap = {
    CollectionFilter: CollectionFilter;
    EntityDuplicator: EntityDuplicator;
    FulfillmentHandler: FulfillmentHandler;
    PaymentMethodEligibilityChecker: PaymentMethodEligibilityChecker;
    PaymentMethodHandler: PaymentMethodHandler;
    PromotionAction: PromotionAction;
    PromotionCondition: PromotionCondition;
    ShippingCalculator: ShippingCalculator;
    ShippingEligibilityChecker: ShippingEligibilityChecker;
};

/**
 * Aliased to the union declared alongside ConfigurableOperationDef, because the same names are also
 * used as translation key segments. Indexing ConfigDefTypeMap by it below means a name in the union
 * with no entry in the map is a compile error.
 */
export type ConfigDefType = ConfigurableOperationDefType;

/**
 * The single source of truth enumerating every configurable-operation registry, keyed by type. The
 * return type is a mapped type over {@link ConfigDefType}, so adding a new operation type is a
 * compile error until its registry is added here. Everything that needs to reason about "all
 * configurable operations" — the config-arg service (redaction/parsing), the bootstrap validation,
 * and so on — derives from this, so a new type cannot be silently omitted from one of them.
 */
export function getConfigurableOperationDefinitions(configService: ConfigService): {
    [K in ConfigDefType]: Array<ConfigDefTypeMap[K]>;
} {
    return {
        CollectionFilter: configService.catalogOptions.collectionFilters,
        EntityDuplicator: configService.entityOptions.entityDuplicators,
        FulfillmentHandler: configService.shippingOptions.fulfillmentHandlers,
        PaymentMethodEligibilityChecker: configService.paymentOptions.paymentMethodEligibilityCheckers || [],
        PaymentMethodHandler: configService.paymentOptions.paymentMethodHandlers,
        PromotionAction: configService.promotionOptions.promotionActions,
        PromotionCondition: configService.promotionOptions.promotionConditions,
        ShippingCalculator: configService.shippingOptions.shippingCalculators,
        ShippingEligibilityChecker: configService.shippingOptions.shippingEligibilityCheckers,
    };
}
