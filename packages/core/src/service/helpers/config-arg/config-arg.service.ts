import { Injectable } from '@nestjs/common';
import { ConfigurableOperation, ConfigurableOperationInput } from '@vendure/common/lib/generated-types';
import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';

import { ConfigurableOperationDef } from '../../../common/configurable-operation';
import { InternalServerError, UserInputError } from '../../../common/error/errors';
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
     *
     * When the operation has `secret` args, their values are encrypted at rest. If the incoming
     * value is the redaction placeholder (i.e. the admin did not re-enter the secret), the previously
     * stored value is preserved; on a create there is nothing to preserve, so the placeholder is
     * rejected.
     */
    parseInput(
        defType: ConfigDefType,
        input: ConfigurableOperationInput,
        previous?: ConfigurableOperation,
    ): ConfigurableOperation {
        const match = this.getByCode(defType, input.code);
        this.validateRequiredFields(input, match);
        const orderedArgs = this.orderArgsToMatchDef(match, input.arguments);
        const args = this.processSecretArgs(match, orderedArgs, previous);
        return {
            code: input.code,
            args,
        };
    }

    /**
     * Encrypts the values of any `secret` args, preserving the previously-stored (encrypted) value
     * when the redaction placeholder is submitted.
     */
    private processSecretArgs(
        def: ConfigurableOperationDef,
        args: ConfigurableOperation['args'],
        previous?: ConfigurableOperation,
    ): ConfigurableOperation['args'] {
        return args.map(arg => {
            const argDef = def.args[arg.name];
            if (!argDef?.secret) {
                return arg;
            }
            if (arg.value === REDACTED_SECRET_PLACEHOLDER) {
                const previousArg = previous?.args?.find(a => a.name === arg.name);
                if (!previousArg) {
                    throw new UserInputError('error.secret-value-required', { name: arg.name });
                }
                // Preserve the existing stored (already-encrypted) value.
                return { name: arg.name, value: previousArg.value };
            }
            if (arg.value == null || arg.value === '') {
                return arg;
            }
            const encryptionStrategy = this.configService.systemOptions.encryptionStrategy;
            if (!encryptionStrategy) {
                throw new InternalServerError(
                    'A `secret` config arg was used, but no EncryptionStrategy is configured.',
                );
            }
            return { name: arg.name, value: encryptionStrategy.encrypt(arg.value) };
        });
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
