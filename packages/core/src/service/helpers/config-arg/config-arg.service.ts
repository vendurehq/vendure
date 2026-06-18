import { Injectable } from '@nestjs/common';
import { ConfigurableOperation, ConfigurableOperationInput } from '@vendure/common/lib/generated-types';

import { ConfigurableOperationDef } from '../../../common/configurable-operation';
import { UserInputError } from '../../../common/error/errors';
import { CollectionFilter } from '../../../config/catalog/collection-filter';
import { ConfigService } from '../../../config/config.service';
import { EntityDuplicator } from '../../../config/entity/entity-duplicator';
import { FulfillmentHandler } from '../../../config/fulfillment/fulfillment-handler';
import { PaymentMethodEligibilityChecker } from '../../../config/payment/payment-method-eligibility-checker';
import { PaymentMethodHandler } from '../../../config/payment/payment-method-handler';
import { PromotionAction } from '../../../config/promotion/promotion-action';
import { PromotionCondition } from '../../../config/promotion/promotion-condition';
import { ShippingCalculator } from '../../../config/shipping-method/shipping-calculator';
import { ShippingEligibilityChecker } from '../../../config/shipping-method/shipping-eligibility-checker';

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

export type ConfigDefType = keyof ConfigDefTypeMap;

/**
 * This helper class provides methods relating to ConfigurableOperationDef instances.
 */
@Injectable()
export class ConfigArgService {
    private readonly definitionsByType: { [K in ConfigDefType]: Array<ConfigDefTypeMap[K]> };

    constructor(private configService: ConfigService) {
        this.definitionsByType = {
            CollectionFilter: this.configService.catalogOptions.collectionFilters,
            EntityDuplicator: this.configService.entityOptions.entityDuplicators,
            FulfillmentHandler: this.configService.shippingOptions.fulfillmentHandlers,
            PaymentMethodEligibilityChecker:
                this.configService.paymentOptions.paymentMethodEligibilityCheckers || [],
            PaymentMethodHandler: this.configService.paymentOptions.paymentMethodHandlers,
            PromotionAction: this.configService.promotionOptions.promotionActions,
            PromotionCondition: this.configService.promotionOptions.promotionConditions,
            ShippingCalculator: this.configService.shippingOptions.shippingCalculators,
            ShippingEligibilityChecker: this.configService.shippingOptions.shippingEligibilityCheckers,
        };
    }

    getDefinitions<T extends ConfigDefType>(defType: T): Array<ConfigDefTypeMap[T]> {
        return this.definitionsByType[defType] as Array<ConfigDefTypeMap[T]>;
    }

    getByCode<T extends ConfigDefType>(defType: T, code: string): ConfigDefTypeMap[T] {
        const defsOfType = this.getDefinitions(defType);
        const match = defsOfType.find(def => def.code === code);
        if (!match) {
            throw new UserInputError('error.no-configurable-operation-def-with-code-found', {
                code,
                type: defType,
            });
        }
        return match;
    }

    /**
     * Parses and validates the input to a ConfigurableOperation.
     */
    parseInput(defType: ConfigDefType, input: ConfigurableOperationInput): ConfigurableOperation {
        const match = this.getByCode(defType, input.code);
        this.validateRequiredFields(input, match);
        const orderedArgs = this.orderArgsToMatchDef(match, input.arguments);
        return {
            code: input.code,
            args: orderedArgs,
        };
    }

    private orderArgsToMatchDef<T extends ConfigDefType>(
        def: ConfigDefTypeMap[T],
        args: ConfigurableOperation['args'],
    ) {
        const output: ConfigurableOperation['args'] = [];
        for (const name of Object.keys(def.args)) {
            const match = args.find(arg => arg.name === name);
            if (match) {
                output.push(match);
            }
        }
        return output;
    }

    private validateRequiredFields(input: ConfigurableOperationInput, def: ConfigurableOperationDef) {
        for (const [name, argDef] of Object.entries(def.args)) {
            if (argDef.required) {
                const inputArg = input.arguments.find(a => a.name === name);

                let valid = false;
                try {
                    if (['string', 'ID', 'datetime'].includes(argDef.type)) {
                        valid = !!inputArg && inputArg.value !== '' && inputArg.value != null;
                    } else {
                        valid = !!inputArg && JSON.parse(inputArg.value) != null;
                    }
                } catch (e: any) {
                    // ignore
                }

                if (!valid) {
                    throw new UserInputError('error.configurable-argument-is-required', {
                        name,
                    });
                }
            }
        }
    }
}
