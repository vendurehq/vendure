import { Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigArgType } from '@vendure/common/lib/shared-types';

import { ConfigArgDef, ConfigurableOperationDef } from '../common/configurable-operation';
import { Injector } from '../common/injector';
import { InjectableStrategy } from '../common/types/injectable-strategy';

import { resetConfig } from './config-helpers';
import { ConfigService } from './config.service';
import { getConfigurableOperationDefinitions } from './configurable-operation-registry';

@Module({
    providers: [ConfigService],
    exports: [ConfigService],
})
export class ConfigModule implements OnApplicationBootstrap, OnApplicationShutdown {
    constructor(
        private configService: ConfigService,
        private moduleRef: ModuleRef,
    ) {}

    async onApplicationBootstrap() {
        await this.initInjectableStrategies();
        await this.initConfigurableOperations();
        this.assertSecretConfigArgsAreValid();
        this.assertEncryptionConfiguredIfSecretsUsed();
    }

    /**
     * A `secret` config arg is encrypted to an unbounded string at rest, so it is only supported on
     * a non-list `string` arg. This mirrors the equivalent validation for `secret` custom fields.
     */
    private assertSecretConfigArgsAreValid() {
        for (const operation of this.getConfigurableOperations()) {
            for (const [name, argDef] of Object.entries<ConfigArgDef<ConfigArgType>>(operation.args)) {
                if (argDef.secret !== true) {
                    continue;
                }
                if (argDef.type !== 'string') {
                    throw new Error(
                        `ERROR: The "${operation.code}" config arg "${name}" has "secret: true", ` +
                            'which is only supported on "string" args.',
                    );
                }
                if (argDef.list === true) {
                    throw new Error(
                        `ERROR: The "${operation.code}" config arg "${name}" cannot combine ` +
                            '"secret: true" with "list: true".',
                    );
                }
            }
        }
    }

    /**
     * If any custom field or config arg is marked `secret` but no usable EncryptionStrategy is
     * configured, fail fast at bootstrap rather than throwing later when a secret value is first
     * written or read.
     */
    private assertEncryptionConfiguredIfSecretsUsed() {
        const { encryptionStrategy } = this.configService.systemOptions;
        if (encryptionStrategy?.isConfigured()) {
            return;
        }
        const hasSecretCustomField = Object.values(this.configService.customFields).some(fields =>
            (fields ?? []).some(f => f.secret === true),
        );
        const hasSecretConfigArg = this.getConfigurableOperations().some(op =>
            Object.values<ConfigArgDef<ConfigArgType>>(op.args).some(arg => arg.secret === true),
        );
        if (hasSecretCustomField || hasSecretConfigArg) {
            throw new Error(
                '[Vendure] A `secret` custom field or config arg is configured, but no EncryptionStrategy ' +
                    'with a usable key is available. Configure one in your VendureConfig:\n\n' +
                    "  import { DefaultEncryptionStrategy } from '@vendure/core';\n\n" +
                    '  systemOptions: {\n' +
                    '    encryptionStrategy: new DefaultEncryptionStrategy({\n' +
                    '      secret: process.env.VENDURE_ENCRYPTION_KEY,\n' +
                    '    }),\n' +
                    '  }\n\n' +
                    'and set the VENDURE_ENCRYPTION_KEY environment variable to a stable, secret value. It ' +
                    'must not change once secret data has been written, or that data can no longer be decrypted.',
            );
        }
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
        const { encryptionStrategy } = this.configService.systemOptions;
        for (const operation of this.getConfigurableOperations()) {
            await operation.init(injector);
            operation.setEncryptionStrategy(encryptionStrategy);
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
            adminApiKeyStrategy,
            shopApiKeyStrategy,
            entityAccessControlStrategy,
            customerChannelAssignmentStrategy,
        } = this.configService.authOptions;
        const { taxZoneStrategy, taxLineCalculationStrategy, orderTaxCalculationStrategy } =
            this.configService.taxOptions;
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
            orderLineDiscountDistributionStrategy,
            orderSellerStrategy,
            guestCheckoutStrategy,
            orderInterceptors,
            orderRecalculationStrategy,
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
        const { cacheStrategy, instrumentationStrategy, encryptionStrategy, secretAccessStrategy } =
            this.configService.systemOptions;
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
            orderTaxCalculationStrategy,
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
            ...(orderRecalculationStrategy ? [orderRecalculationStrategy] : []),
            orderLineDiscountDistributionStrategy,
            ...(Array.isArray(activeOrderStrategy) ? activeOrderStrategy : [activeOrderStrategy]),
            orderSellerStrategy,
            shippingLineAssignmentStrategy,
            stockLocationStrategy,
            productVariantPriceSelectionStrategy,
            guestCheckoutStrategy,
            ...refundProcess,
            cacheStrategy,
            ...(instrumentationStrategy ? [instrumentationStrategy] : []),
            ...(encryptionStrategy ? [encryptionStrategy] : []),
            ...(secretAccessStrategy ? [secretAccessStrategy] : []),
            ...orderInterceptors,
            schedulerStrategy,
            adminApiKeyStrategy,
            shopApiKeyStrategy,
            entityAccessControlStrategy,
            customerChannelAssignmentStrategy,
        ];
    }

    private getConfigurableOperations(): Array<ConfigurableOperationDef<any>> {
        return Object.values(getConfigurableOperationDefinitions(this.configService)).flat();
    }
}
