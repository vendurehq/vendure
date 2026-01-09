import { Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { ConfigurableOperationDef } from '../common/configurable-operation';
import { Injector } from '../common/injector';
import { InjectableStrategy } from '../common/types/injectable-strategy';

import { resetConfig } from './config-helpers';
import { ConfigService } from './config.service';

@Module({
    providers: [ConfigService],
    exports: [ConfigService],
})
export class ConfigModule implements OnModuleInit, OnApplicationShutdown {
    constructor(
        private configService: ConfigService,
        private moduleRef: ModuleRef,
    ) {}

    async onModuleInit() {
        await this.initInjectableStrategies();
        await this.initConfigurableOperations();
    }

    async onApplicationShutdown(signal?: string) {
        await this.destroyInjectableStrategies();
        await this.destroyConfigurableOperations();
        /**
         * When the application shuts down, we reset the activeConfig to the default. Usually this is
         * redundant, as the app shutdown would normally coincide with the process ending. However, in some
         * circumstances, such as when running migrations immediately followed by app bootstrap, the activeConfig
         * will persist between these two applications and mutations e.g. to the CustomFields will result in
         * hard-to-debug errors. So resetting is a precaution against this scenario.
         */
        resetConfig();
    }

    private async initInjectableStrategies() {
        const injector = new Injector(this.moduleRef);
        for (const strategy of this.getInjectableStrategies()) {
            if (typeof strategy.init === 'function') {
                await strategy.init(injector);
            }
        }
    }

    private async destroyInjectableStrategies() {
        for (const strategy of this.getInjectableStrategies()) {
            if (typeof strategy.destroy === 'function') {
                await strategy.destroy();
            }
        }
    }

    private async initConfigurableOperations() {
        const injector = new Injector(this.moduleRef);
        for (const operation of this.getConfigurableOperations()) {
            await operation.init(injector);
        }
    }

    private async destroyConfigurableOperations() {
        for (const operation of this.getConfigurableOperations()) {
            await operation.destroy();
        }
    }

    private getInjectableStrategies(): InjectableStrategy[] {
        const { assetNamingStrategy, assetPreviewStrategy, assetStorageStrategy } =
            this.configService.assetOptions;
        const {
            productVariantPriceCalculationStrategy,
            productVariantPriceSelectionStrategy,
            productVariantPriceUpdateStrategy,
            stockDisplayStrategy,
            stockLocationStrategy,
        } = this.configService.catalogOptions;
        const {
            adminAuthenticationStrategy,
            shopAuthenticationStrategy,
            sessionCacheStrategy,
            passwordHashingStrategy,
            passwordValidationStrategy,
            verificationTokenStrategy,
        } = this.configService.authOptions;
        const { taxZoneStrategy, taxLineCalculationStrategy } = this.configService.taxOptions;
        const { jobQueueStrategy, jobBufferStorageStrategy } = this.configService.jobQueueOptions;
        const { schedulerStrategy } = this.configService.schedulerOptions;
        const {
            mergeStrategy,
            checkoutMergeStrategy,
            orderItemPriceCalculationStrategy,
            process: orderProcess,
            orderCodeStrategy,
            orderByCodeAccessStrategy,
            stockAllocationStrategy,
            activeOrderStrategy,
            changedPriceHandlingStrategy,
            orderSellerStrategy,
            guestCheckoutStrategy,
            orderInterceptors,
        } = this.configService.orderOptions;
        const {
            customFulfillmentProcess,
            process: fulfillmentProcess,
            shippingLineAssignmentStrategy,
        } = this.configService.shippingOptions;
        const { customPaymentProcess, process: paymentProcess } = this.configService.paymentOptions;
        const { entityIdStrategy: entityIdStrategyDeprecated } = this.configService;
        const { entityIdStrategy: entityIdStrategyCurrent } = this.configService.entityOptions;
        const { healthChecks, errorHandlers } = this.configService.systemOptions;
        const { assetImportStrategy } = this.configService.importExportOptions;
        const { refundProcess: refundProcess } = this.configService.paymentOptions;
        const { cacheStrategy, instrumentationStrategy } = this.configService.systemOptions;
        const entityIdStrategy = entityIdStrategyCurrent ?? entityIdStrategyDeprecated;
        return [
            ...adminAuthenticationStrategy,
            ...shopAuthenticationStrategy,
            sessionCacheStrategy,
            passwordHashingStrategy,
            passwordValidationStrategy,
            verificationTokenStrategy,
            assetNamingStrategy,
            assetPreviewStrategy,
            assetStorageStrategy,
            taxZoneStrategy,
            taxLineCalculationStrategy,
            jobQueueStrategy,
            jobBufferStorageStrategy,
            mergeStrategy,
            checkoutMergeStrategy,
            orderCodeStrategy,
            orderByCodeAccessStrategy,
            entityIdStrategy,
            productVariantPriceCalculationStrategy,
            productVariantPriceUpdateStrategy,
            orderItemPriceCalculationStrategy,
            ...orderProcess,
            ...customFulfillmentProcess,
            ...fulfillmentProcess,
            ...customPaymentProcess,
            ...paymentProcess,
            stockAllocationStrategy,
            stockDisplayStrategy,
            ...healthChecks,
            ...errorHandlers,
            assetImportStrategy,
            changedPriceHandlingStrategy,
            ...(Array.isArray(activeOrderStrategy) ? activeOrderStrategy : [activeOrderStrategy]),
            orderSellerStrategy,
            shippingLineAssignmentStrategy,
            stockLocationStrategy,
            productVariantPriceSelectionStrategy,
            guestCheckoutStrategy,
            ...refundProcess,
            cacheStrategy,
            ...(instrumentationStrategy ? [instrumentationStrategy] : []),
            ...orderInterceptors,
            schedulerStrategy,
        ];
    }

    private getConfigurableOperations(): Array<ConfigurableOperationDef<any>> {
        const { paymentMethodHandlers, paymentMethodEligibilityCheckers } = this.configService.paymentOptions;
        const { collectionFilters } = this.configService.catalogOptions;
        const { entityDuplicators } = this.configService.entityOptions;
        const { promotionActions, promotionConditions } = this.configService.promotionOptions;
        const { shippingCalculators, shippingEligibilityCheckers, fulfillmentHandlers } =
            this.configService.shippingOptions;
        return [
            ...(paymentMethodEligibilityCheckers || []),
            ...paymentMethodHandlers,
            ...collectionFilters,
            ...(promotionActions || []),
            ...(promotionConditions || []),
            ...(shippingCalculators || []),
            ...(shippingEligibilityCheckers || []),
            ...(fulfillmentHandlers || []),
            ...(entityDuplicators || []),
        ];
    }
}
