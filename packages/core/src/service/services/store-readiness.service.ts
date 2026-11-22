import { Injectable } from '@nestjs/common';
import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';
import { Permission } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { Logger } from '../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Channel } from '../../entity/channel/channel.entity';
import { PasswordCipher } from '../helpers/password-cipher/password-cipher';
import { RequestContextService } from '../helpers/request-context/request-context.service';
import { checkDefaultZones } from '../helpers/store-readiness/default-zones.check';
import { checkPaymentMethods } from '../helpers/store-readiness/payment-methods.check';
import { checkPrices } from '../helpers/store-readiness/prices.check';
import { checkSearchIndex } from '../helpers/store-readiness/search-index.check';
import { findShippingZones } from '../helpers/store-readiness/shipping-zones';
import { checkShipping } from '../helpers/store-readiness/shipping.check';
import { checkStockLocations } from '../helpers/store-readiness/stock-locations.check';
import {
    ChannelReadinessInput,
    StoreReadinessFinding,
    StoreReadinessReport,
    toFinding,
} from '../helpers/store-readiness/store-readiness-types';
import { checkSuperadminCredentials } from '../helpers/store-readiness/superadmin-credentials.check';
import { checkTaxRateOverlaps } from '../helpers/store-readiness/tax-rate-overlaps.check';
import { checkTaxRates } from '../helpers/store-readiness/tax-rates.check';

import { ChannelService } from './channel.service';
import { OrderTestingService } from './order-testing.service';
import { PaymentMethodService } from './payment-method.service';
import { RoleService } from './role.service';
import { ShippingMethodService } from './shipping-method.service';
import { StockLocationService } from './stock-location.service';
import { TaxRateService } from './tax-rate.service';
import { ZoneService } from './zone.service';

const checkFailed = defineError<{ check: string; channel?: Channel; error: unknown }>({
    code: 'store.check.failed',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ check, channel, error }) =>
        `The "${check}" check failed${channel ? ` for channel "${channel.code}"` : ''}: ` +
        (error instanceof Error ? error.message : String(error)),
});

/**
 * @description
 * Reports the setup gaps that stop a Channel from taking an order, such as a missing tax rate, no
 * shipping method that is eligible for a Zone, or no payment method. Each gap is a coded
 * {@link StoreReadinessFinding} with the MCP admin tool calls that fix it.
 *
 * The check writes nothing and publishes no events, so it is safe to run on a live store. It checks
 * shipping for one sample country per Zone, with an order built in memory by
 * {@link OrderTestingService}.
 *
 * The same report backs the Admin API `storeReadiness` query and the `check_store` MCP tool.
 *
 * @docsCategory services
 * @since 4.0.0
 */
@Injectable()
export class StoreReadinessService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private channelService: ChannelService,
        private zoneService: ZoneService,
        private taxRateService: TaxRateService,
        private shippingMethodService: ShippingMethodService,
        private paymentMethodService: PaymentMethodService,
        private stockLocationService: StockLocationService,
        private orderTestingService: OrderTestingService,
        private requestContextService: RequestContextService,
        private roleService: RoleService,
        private passwordCipher: PasswordCipher,
    ) {}

    /**
     * @description
     * Checks every Channel on which the active user holds `ReadSettings`, or only the given Channels
     * among those. A check that throws is reported as a `store.check.failed` finding, so one broken
     * check does not hide the others.
     */
    async check(ctx: RequestContext, options: { channelIds?: ID[] } = {}): Promise<StoreReadinessReport> {
        const findings: StoreReadinessFinding[] = [];
        const run = async (check: string, fn: () => Promise<StoreReadinessFinding[]>, channel?: Channel) => {
            try {
                findings.push(...(await fn()));
            } catch (error) {
                Logger.error(
                    `Store readiness check "${check}" failed: ${error instanceof Error ? error.message : String(error)}`,
                    undefined,
                    error instanceof Error ? error.stack : undefined,
                );
                findings.push(
                    toFinding(checkFailed, 'error', { check, channel, error }, { channelId: channel?.id }),
                );
            }
        };

        let shippingZones: ChannelReadinessInput['shippingZones'] = [];
        await run('shipping-zones', async () => {
            const result = await findShippingZones(ctx, this.zoneService);
            shippingZones = result.shippingZones;
            return result.findings;
        });
        await run('tax-rate-overlaps', () => checkTaxRateOverlaps(ctx, this.taxRateService));
        await run('superadmin-credentials', () =>
            checkSuperadminCredentials(ctx, {
                connection: this.connection,
                configService: this.configService,
                passwordCipher: this.passwordCipher,
            }),
        );

        for (const channel of await this.findChannelsToCheck(ctx, options.channelIds)) {
            const input: ChannelReadinessInput = {
                ctx: await this.createChannelContext(ctx, channel),
                channel,
                shippingZones,
            };
            await run('default-zones', () => Promise.resolve(checkDefaultZones(input)), channel);
            await run('prices', () => checkPrices(input, this.connection), channel);
            await run('tax-rates', () => checkTaxRates(input, this.connection, this.taxRateService), channel);
            await run(
                'shipping',
                () =>
                    checkShipping(input, {
                        connection: this.connection,
                        shippingMethodService: this.shippingMethodService,
                        orderTestingService: this.orderTestingService,
                    }),
                channel,
            );
            await run(
                'payment-methods',
                () => checkPaymentMethods(input, this.paymentMethodService, this.configService),
                channel,
            );
            await run(
                'stock-locations',
                () => checkStockLocations(input, this.stockLocationService),
                channel,
            );
            await run('search-index', () => checkSearchIndex(input, this.connection), channel);
        }

        return { ready: !findings.some(finding => finding.severity === 'error'), findings };
    }

    private async findChannelsToCheck(ctx: RequestContext, channelIds?: ID[]): Promise<Channel[]> {
        const { items } = await this.channelService.findAll(ctx);
        const channels: Channel[] = [];
        for (const channel of items) {
            if (channelIds && !channelIds.some(id => idsAreEqual(id, channel.id))) {
                continue;
            }
            if (
                !(await this.roleService.userHasPermissionOnChannel(ctx, channel.id, Permission.ReadSettings))
            ) {
                continue;
            }
            // findAll() does not load the default Zones, which the default-zones check reads.
            const withZones = await this.channelService.findOne(ctx, channel.id);
            if (withZones) {
                channels.push(withZones);
            }
        }
        return channels;
    }

    /**
     * Services scope their queries by `ctx.channel`, and the sample order is priced in the Channel's
     * default currency and language, so each Channel is checked with a context of its own.
     */
    private createChannelContext(ctx: RequestContext, channel: Channel): Promise<RequestContext> {
        return this.requestContextService.create({
            apiType: ctx.apiType,
            channelOrToken: channel,
            languageCode: channel.defaultLanguageCode,
            currencyCode: channel.defaultCurrencyCode,
        });
    }
}
