import { DynamicModule, Injectable, Type } from '@nestjs/common';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DataSourceOptions } from 'typeorm';

import { getConfig } from './config-helpers';
import { CustomFields } from './custom-field/custom-field-types';
import { EntityIdStrategy } from './entity/entity-id-strategy';
import { Logger, VendureLogger } from './logger/vendure-logger';
import { SettingsStoreFields } from './settings-store/settings-store-types';
import {
    ApiOptions,
    AssetOptions,
    CatalogOptions,
    EntityOptions,
    ImportExportOptions,
    JobQueueOptions,
    OrderOptions,
    PaymentOptions,
    PromotionOptions,
    RuntimeVendureConfig,
    SchedulerOptions,
    ShippingOptions,
    SystemOptions,
    TaxOptions,
    VendureConfig,
} from './vendure-config';

@Injectable()
export class ConfigService implements VendureConfig {
    private activeConfig: RuntimeVendureConfig;

    constructor() {
        this.activeConfig = getConfig();
        if (this.activeConfig.authOptions.disableAuth) {
            // eslint-disable-next-line
            Logger.warn('Auth has been disabled. This should never be the case for a production system!');
        }
    }

    get apiOptions(): Required<ApiOptions> {
        return this.activeConfig.apiOptions;
    }

    get authOptions() {
        return this.activeConfig.authOptions;
    }

    get catalogOptions(): Required<CatalogOptions> {
        return this.activeConfig.catalogOptions;
    }

    get defaultChannelToken(): string | null {
        return this.activeConfig.defaultChannelToken;
    }

    get defaultLanguageCode(): LanguageCode {
        return this.activeConfig.defaultLanguageCode;
    }

    get entityOptions(): Required<Omit<EntityOptions, 'entityIdStrategy'>> & EntityOptions {
        return this.activeConfig.entityOptions;
    }

    get entityIdStrategy(): EntityIdStrategy<any> {
        return this.activeConfig.entityIdStrategy;
    }

    get assetOptions(): Required<AssetOptions> {
        return this.activeConfig.assetOptions;
    }

    get dbConnectionOptions(): DataSourceOptions {
        return this.activeConfig.dbConnectionOptions;
    }

    get promotionOptions(): Required<PromotionOptions> {
        return this.activeConfig.promotionOptions;
    }

    get shippingOptions(): Required<ShippingOptions> {
        return this.activeConfig.shippingOptions;
    }

    get orderOptions(): Required<OrderOptions> {
        return this.activeConfig.orderOptions;
    }

    get paymentOptions(): Required<PaymentOptions> {
        return this.activeConfig.paymentOptions as Required<PaymentOptions>;
    }

    get taxOptions(): Required<TaxOptions> {
        return this.activeConfig.taxOptions;
    }

    get importExportOptions(): Required<ImportExportOptions> {
        return this.activeConfig.importExportOptions;
    }

    get customFields(): Required<CustomFields> {
        // Every entity that supports custom fields already has an entry here: `runPluginConfigurations`
        // seeds one for each of them during `preBootstrapConfig`, which completes before the Nest app,
        // and so before any `ConfigService`, exists.
        return this.activeConfig.customFields;
    }

    get plugins(): Array<DynamicModule | Type<any>> {
        return this.activeConfig.plugins;
    }

    get logger(): VendureLogger {
        return this.activeConfig.logger;
    }

    get jobQueueOptions(): Required<JobQueueOptions> {
        return this.activeConfig.jobQueueOptions;
    }

    get schedulerOptions(): Required<Omit<SchedulerOptions, 'timezone'>> & SchedulerOptions {
        return this.activeConfig.schedulerOptions;
    }

    get systemOptions(): Required<SystemOptions> {
        return this.activeConfig.systemOptions;
    }

    get settingsStoreFields(): SettingsStoreFields {
        return this.activeConfig.settingsStoreFields ?? {};
    }

    /**
     * This is a precaution against attempting to JSON.stringify() a reference to
     * this class, which can lead to a circular reference error.
     */
    protected toJSON() {
        return {};
    }
}
