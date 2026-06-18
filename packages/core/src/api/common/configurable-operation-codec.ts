import { Injectable } from '@nestjs/common';
import { ConfigurableOperation, ConfigurableOperationInput } from '@vendure/common/lib/generated-types';
import { Type } from '@vendure/common/lib/shared-types';

import { ConfigurableOperationDef } from '../../common/configurable-operation';
import { InternalServerError } from '../../common/error/errors';
import {
    PromotionCondition,
    PromotionItemAction,
    PromotionOrderAction,
    ShippingCalculator,
    ShippingEligibilityChecker,
} from '../../config';
import { CollectionFilter } from '../../config/catalog/collection-filter';
import { ConfigService } from '../../config/config.service';
import { PaymentMethodEligibilityChecker } from '../../config/payment/payment-method-eligibility-checker';
import { PaymentMethodHandler } from '../../config/payment/payment-method-handler';

import { IdCodecService } from './id-codec.service';

@Injectable()
export class ConfigurableOperationCodec {
    constructor(private configService: ConfigService, private idCodecService: IdCodecService) {}

    /**
     * Decodes any ID type arguments of a ConfigurableOperationDef
     */
    decodeConfigurableOperationIds<T extends ConfigurableOperationDef<any>>(
        defType: Type<ConfigurableOperationDef<any>>,
        input: ConfigurableOperationInput[],
    ): ConfigurableOperationInput[] {
        const availableDefs = this.getAvailableDefsOfType(defType);
        for (const operationInput of input) {
            const def = availableDefs.find(d => d.code === operationInput.code);
            if (!def) {
                continue;
            }
            for (const arg of operationInput.arguments) {
                const argDef = def.args[arg.name];
                if (argDef && argDef.type === 'ID' && arg.value) {
                    if (argDef.list === true) {
                        const ids = JSON.parse(arg.value) as string[];
                        const decodedIds = ids.map(id => this.idCodecService.decode(id));
                        arg.value = JSON.stringify(decodedIds);
                    } else {
                        arg.value = this.idCodecService.decode(arg.value);
                    }
                }
            }
        }
        return input;
    }

    /**
     * Encodes any ID type arguments of a ConfigurableOperationDef
     */
    encodeConfigurableOperationIds<T extends ConfigurableOperationDef<any>>(
        defType: Type<ConfigurableOperationDef<any>>,
        input: ConfigurableOperation[],
    ): ConfigurableOperation[] {
        const availableDefs = this.getAvailableDefsOfType(defType);
        for (const operationInput of input) {
            const def = availableDefs.find(d => d.code === operationInput.code);
            if (!def) {
                continue;
            }
            for (const arg of operationInput.args) {
                const argDef = def.args[arg.name];
                if (argDef && argDef.type === 'ID' && arg.value) {
                    if (argDef.list === true) {
                        const ids = JSON.parse(arg.value) as string[];
                        const encodedIds = ids.map(id => this.idCodecService.encode(id));
                        arg.value = JSON.stringify(encodedIds);
                    } else {
                        const encodedId = this.idCodecService.encode(arg.value);
                        arg.value = JSON.stringify(encodedId);
                    }
                }
            }
        }
        return input;
    }

    getAvailableDefsOfType(defType: Type<ConfigurableOperationDef>): ConfigurableOperationDef[] {
        switch (defType) {
            case CollectionFilter:
                return this.configService.catalogOptions.collectionFilters;
            case PaymentMethodHandler:
                return this.configService.paymentOptions.paymentMethodHandlers;
            case PaymentMethodEligibilityChecker:
                return this.configService.paymentOptions.paymentMethodEligibilityCheckers || [];
            case PromotionItemAction:
            case PromotionOrderAction:
                return this.configService.promotionOptions.promotionActions || [];
            case PromotionCondition:
                return this.configService.promotionOptions.promotionConditions || [];
            case ShippingEligibilityChecker:
                return this.configService.shippingOptions.shippingEligibilityCheckers || [];
            case ShippingCalculator:
                return this.configService.shippingOptions.shippingCalculators || [];
            default:
                throw new InternalServerError('error.unknown-configurable-operation-definition', {
                    name: defType.name,
                });
        }
    }
}
