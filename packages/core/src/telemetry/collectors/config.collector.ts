import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';
import { getStrategyName } from '../helpers/strategy-name.helper';
import { TelemetryConfig } from '../telemetry.types';

/**
 * Collects configuration information for telemetry.
 * Only collects strategy class names and non-sensitive configuration values.
 */
@Injectable()
export class ConfigCollector {
    constructor(private readonly configService: ConfigService) {}

    collect(): TelemetryConfig {
        const customFieldsPerEntity = this.getCustomFieldsPerEntity();
        const customFieldsCount = Object.values(customFieldsPerEntity).reduce((sum, c) => sum + c, 0);
        return {
            assetStorageType: this.getAssetStorageType(),
            jobQueueType: this.getJobQueueType(),
            entityIdStrategy: this.getEntityIdStrategy(),
            defaultLanguage: this.getDefaultLanguage(),
            customFieldsCount,
            authenticationMethods: this.getAuthenticationMethods(),
            moneyStrategy: this.getMoneyStrategy(),
            cacheStrategy: this.getCacheStrategy(),
            taxLineCalculationStrategy: this.getTaxLineCalculationStrategy(),
            orderSellerStrategy: this.getOrderSellerStrategy(),
            paymentHandlerCodes: this.getPaymentHandlerCodes(),
            shippingCalculatorCodes: this.getShippingCalculatorCodes(),
            fulfillmentHandlerCodes: this.getFulfillmentHandlerCodes(),
            promotionConditionCount: this.getPromotionConditionCount(),
            promotionActionCount: this.getPromotionActionCount(),
            scheduledTaskCount: this.getScheduledTaskCount(),
            customFieldsPerEntity,
            hasCustomOrderProcess: this.hasCustomOrderProcess(),
            hasCustomPaymentProcess: this.hasCustomPaymentProcess(),
            hasCustomFulfillmentProcess: this.hasCustomFulfillmentProcess(),
        };
    }

    private getDefaultLanguage(): string | undefined {
        try {
            return this.configService.defaultLanguageCode;
        } catch {
            return undefined;
        }
    }

    private getAssetStorageType(): string {
        try {
            return getStrategyName(this.configService.assetOptions.assetStorageStrategy);
        } catch {
            return 'unknown';
        }
    }

    private getJobQueueType(): string {
        try {
            return getStrategyName(this.configService.jobQueueOptions.jobQueueStrategy);
        } catch {
            return 'unknown';
        }
    }

    private getEntityIdStrategy(): string {
        try {
            const strategy =
                this.configService.entityOptions.entityIdStrategy ?? this.configService.entityIdStrategy;
            return strategy ? getStrategyName(strategy) : 'unknown';
        } catch {
            return 'unknown';
        }
    }

    private getAuthenticationMethods(): string[] {
        try {
            const methods = new Set<string>();

            const adminStrategies = this.configService.authOptions.adminAuthenticationStrategy;
            const shopStrategies = this.configService.authOptions.shopAuthenticationStrategy;

            for (const strategy of adminStrategies) {
                methods.add(getStrategyName(strategy));
            }

            for (const strategy of shopStrategies) {
                methods.add(getStrategyName(strategy));
            }

            return Array.from(methods).sort((a, b) => a.localeCompare(b));
        } catch {
            return [];
        }
    }

    private getMoneyStrategy(): string {
        try {
            const strategy = this.configService.entityOptions.moneyStrategy;
            return strategy ? getStrategyName(strategy) : 'unknown';
        } catch {
            return 'unknown';
        }
    }

    private getCacheStrategy(): string {
        try {
            return getStrategyName(this.configService.systemOptions.cacheStrategy);
        } catch {
            return 'unknown';
        }
    }

    private getTaxLineCalculationStrategy(): string {
        try {
            return getStrategyName(this.configService.taxOptions.taxLineCalculationStrategy);
        } catch {
            return 'unknown';
        }
    }

    private getOrderSellerStrategy(): string {
        try {
            const strategy = this.configService.orderOptions.orderSellerStrategy;
            return strategy ? getStrategyName(strategy) : 'unknown';
        } catch {
            return 'unknown';
        }
    }

    private getPaymentHandlerCodes(): string[] {
        try {
            return this.configService.paymentOptions.paymentMethodHandlers.map(h => h.code);
        } catch {
            return [];
        }
    }

    private getShippingCalculatorCodes(): string[] {
        try {
            return this.configService.shippingOptions.shippingCalculators.map(c => c.code);
        } catch {
            return [];
        }
    }

    private getFulfillmentHandlerCodes(): string[] {
        try {
            return this.configService.shippingOptions.fulfillmentHandlers.map(h => h.code);
        } catch {
            return [];
        }
    }

    private getPromotionConditionCount(): number {
        try {
            return this.configService.promotionOptions.promotionConditions?.length ?? 0;
        } catch {
            return 0;
        }
    }

    private getPromotionActionCount(): number {
        try {
            return this.configService.promotionOptions.promotionActions?.length ?? 0;
        } catch {
            return 0;
        }
    }

    private getScheduledTaskCount(): number {
        try {
            return this.configService.schedulerOptions.tasks?.length ?? 0;
        } catch {
            return 0;
        }
    }

    private getCustomFieldsPerEntity(): Record<string, number> {
        try {
            const customFields = this.configService.customFields;
            const result: Record<string, number> = {};

            for (const entityName of Object.keys(customFields)) {
                const fields = customFields[entityName as keyof typeof customFields];
                if (Array.isArray(fields) && fields.length > 0) {
                    result[entityName] = fields.length;
                }
            }

            return result;
        } catch {
            return {};
        }
    }

    private hasCustomOrderProcess(): boolean {
        try {
            return (this.configService.orderOptions.process?.length ?? 0) > 0;
        } catch {
            return false;
        }
    }

    private hasCustomPaymentProcess(): boolean {
        try {
            return (this.configService.paymentOptions.process?.length ?? 0) > 0;
        } catch {
            return false;
        }
    }

    private hasCustomFulfillmentProcess(): boolean {
        try {
            return (this.configService.shippingOptions.process?.length ?? 0) > 0;
        } catch {
            return false;
        }
    }
}
