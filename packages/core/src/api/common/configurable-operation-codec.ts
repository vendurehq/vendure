import { Injectable } from '@nestjs/common';
import { ConfigurableOperation, ConfigurableOperationInput } from '@vendure/common/lib/generated-types';
import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import { Type } from '@vendure/common/lib/shared-types';

import { ConfigurableOperationDef } from '../../common/configurable-operation';
import { InternalServerError } from '../../common/error/errors';
import { VendureEntity } from '../../entity/base/base.entity';
import { RequestContext } from '../common/request-context';
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
                        // Non-list IDs are stored raw (not JSON-stringified) to stay
                        // symmetric with the decode branch, which reads them raw since
                        // #2483 (47f606cc). Stringifying here re-quotes the id on a
                        // read → save round-trip (e.g. `'T_1'` → `'"T_1"'`), which then
                        // mis-decodes on the way back in — the root cause of #4856.
                        arg.value = this.idCodecService.encode(arg.value);
                    }
                }
            }
        }
        return input;
    }

    /**
     * Returns a copy of the given operations in which the values of any `secret` args are either
     * decrypted (if the {@link SecretAccessStrategy} permits) or replaced with a redaction
     * placeholder. The input operations are not mutated, so the stored (encrypted) values on the
     * source entity are left intact.
     */
    async redactSecretArgs(
        ctx: RequestContext,
        defType: Type<ConfigurableOperationDef<any>>,
        input: ConfigurableOperation[],
        entity?: VendureEntity,
    ): Promise<ConfigurableOperation[]> {
        const availableDefs = this.getAvailableDefsOfType(defType);
        const { secretAccessStrategy, encryptionStrategy } = this.configService.systemOptions;
        const output: ConfigurableOperation[] = [];
        for (const operation of input) {
            const def = availableDefs.find(d => d.code === operation.code);
            const args = [];
            for (const arg of operation.args) {
                const argDef = def?.args[arg.name];
                if (!argDef?.secret || arg.value == null) {
                    args.push({ ...arg });
                    continue;
                }
                const canReveal = secretAccessStrategy
                    ? await secretAccessStrategy.canAccessSecret(ctx, {
                          operation: 'read',
                          entityType: entity?.constructor.name ?? defType.name,
                          entity,
                          fieldName: arg.name,
                      })
                    : false;
                const value =
                    canReveal && encryptionStrategy
                        ? encryptionStrategy.decrypt(arg.value)
                        : REDACTED_SECRET_PLACEHOLDER;
                args.push({ name: arg.name, value });
            }
            output.push({ code: operation.code, args });
        }
        return output;
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
