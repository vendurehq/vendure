import { Injectable } from '@nestjs/common';

import { Logger } from '../config/logger/vendure-logger';
import { TransactionalConnection } from '../connection/transactional-connection';
import { Administrator } from '../entity/administrator/administrator.entity';
import { EventBus } from '../event-bus';
import { InitializerEvent } from '../event-bus/events/initializer-event';
import { ensureRoleAssignmentDataMigrated } from '../migration-utils/v4_0_role_assignments';

import { AdministratorService } from './services/administrator.service';
import { ChannelService } from './services/channel.service';
import { GlobalSettingsService } from './services/global-settings.service';
import { RoleService } from './services/role.service';
import { SellerService } from './services/seller.service';
import { ShippingMethodService } from './services/shipping-method.service';
import { StockLocationService } from './services/stock-location.service';
import { TaxRateService } from './services/tax-rate.service';
import { ZoneService } from './services/zone.service';

/**
 * @description
 * Only used internally to run the various service init methods in the correct
 * sequence on bootstrap.
 *
 * @docsCategory services
 */
@Injectable()
export class InitializerService {
    constructor(
        private connection: TransactionalConnection,
        private zoneService: ZoneService,
        private channelService: ChannelService,
        private roleService: RoleService,
        private administratorService: AdministratorService,
        private shippingMethodService: ShippingMethodService,
        private globalSettingsService: GlobalSettingsService,
        private taxRateService: TaxRateService,
        private sellerService: SellerService,
        private eventBus: EventBus,
        private stockLocationService: StockLocationService,
    ) {}

    async onModuleInit() {
        await this.awaitDbSchemaGeneration();
        await this.ensureRoleAssignmentDataMigrated();
        // IMPORTANT - why manually invoke these init methods rather than just relying on
        // Nest's "onModuleInit" lifecycle hook within each individual service class?
        // The reason is that the order of invocation matters. By explicitly invoking the
        // methods below, we can e.g. guarantee that the default channel exists
        // (channelService.initChannels()) before we try to create any roles (which assume that
        // there is a default Channel to work with.
        await this.zoneService.initZones();
        await this.globalSettingsService.initGlobalSettings();
        await this.sellerService.initSellers();
        await this.channelService.initChannels();
        await this.roleService.initRoles();
        await this.administratorService.initAdministrators();
        await this.shippingMethodService.initShippingMethods();
        await this.taxRateService.initTaxRates();
        await this.stockLocationService.initStockLocations();
        await this.eventBus.publish(new InitializerEvent());
    }

    /**
     * Refuses to start on a database whose pre-v4 role grants have not been migrated: the
     * role_assignment table would be empty and every Administrator except the configured
     * superadmin would be locked out. With synchronize enabled there is no migration to run
     * the data migration from, so it runs here instead.
     */
    private async ensureRoleAssignmentDataMigrated() {
        const queryRunner = this.connection.rawConnection.createQueryRunner();
        try {
            const migrated = await ensureRoleAssignmentDataMigrated(queryRunner, {
                synchronize: !!this.connection.rawConnection.options.synchronize,
            });
            if (migrated) {
                Logger.info('Migrated the pre-v4 role grants to role assignments (synchronize is enabled)');
            }
        } finally {
            await queryRunner.release();
        }
    }

    /**
     * On the first run of the server & worker, when dbConnectionOptions.synchronize = true, there can be
     * a race condition where the worker starts up before the server process has had a chance to generate
     * the DB schema. This results in a fatal error as the worker is not able to run its initialization
     * tasks which interact with the DB.
     *
     * This method applies retry logic to give the server time to populate the schema before the worker
     * continues with its bootstrap process.
     */
    private async awaitDbSchemaGeneration() {
        const retries = 20;
        const delayMs = 100;
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const result = await this.connection.rawConnection.getRepository(Administrator).find();
                return;
            } catch (e: any) {
                if (attempt < retries - 1) {
                    Logger.warn(`Awaiting DB schema creation... (attempt ${attempt})`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                } else {
                    Logger.error('Timed out when awaiting the DB schema to be ready!', undefined, e.stack);
                }
            }
        }
    }
}
