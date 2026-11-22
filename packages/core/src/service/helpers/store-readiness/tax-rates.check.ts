import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';
import { ID } from '@vendure/common/lib/shared-types';
import { In } from 'typeorm';

import { TaxZoneStrategy } from '../../../config/tax/tax-zone-strategy';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { Order } from '../../../entity/order/order.entity';
import { TaxCategory } from '../../../entity/tax-category/tax-category.entity';
import { Zone } from '../../../entity/zone/zone.entity';
import { TaxRateService } from '../../services/tax-rate.service';

import {
    adminToolPath,
    ChannelReadinessInput,
    countryMembers,
    StoreReadinessFinding,
    toFinding,
} from './store-readiness-types';
import { findChannelTaxCategoryIds } from './variant-queries';

interface NoRateDetails {
    channel: Channel;
    zone: Zone;
    taxCategory: TaxCategory;
    /** The countries whose orders get this tax zone and no rate. */
    countryCodes: string[];
    /** Whether an order with no address yet gets no rate either. */
    withoutAddress: boolean;
}

export const noApplicableTaxRate = defineError<NoRateDetails>({
    code: 'store.tax.no-rate',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel, zone, taxCategory, countryCodes, withoutAddress }) => {
        const orders = [
            ...(countryCodes.length ? [`orders to ${countryCodes.join(', ')}`] : []),
            ...(withoutAddress ? ['orders with no address yet'] : []),
        ].join(' and ');
        return (
            `No tax rate for tax category "${taxCategory.name}" applies to ${orders} in channel ` +
            `"${channel.code}", whose tax zone is "${zone.name}", so they are taxed at 0%.`
        );
    },
    fix: ({ zone, taxCategory }) => [
        {
            path: adminToolPath('create_tax_rate'),
            input: {
                input: {
                    name: `${taxCategory.name} ${zone.name}`,
                    taxCategoryId: taxCategory.id,
                    target: { zoneId: zone.id },
                },
            },
            description: `Add a rate for the zone, with its percentage as "value". A rate per country works too.`,
        },
    ],
});

/** An order to one country, or with no address, as the tax zone strategy sees it. */
interface TaxTarget {
    countryCode?: string;
}

/**
 * For each tax category the Channel's variants use, an order to each country the Channel ships to,
 * and an order with no address yet, get a configured tax rate. The tax zone of each order comes from
 * the configured {@link TaxZoneStrategy}, and the rate from {@link TaxRateService}, as at checkout.
 */
export async function checkTaxRates(
    { ctx, channel, allZones, shippingZones }: ChannelReadinessInput,
    services: {
        connection: TransactionalConnection;
        taxRateService: TaxRateService;
        taxZoneStrategy: TaxZoneStrategy;
    },
): Promise<StoreReadinessFinding[]> {
    const categoryIds = await findChannelTaxCategoryIds(ctx, services.connection, channel.id);
    if (categoryIds.length === 0) {
        return [];
    }
    const countryCodes = [
        ...new Set(
            shippingZones.flatMap(zone =>
                countryMembers(zone)
                    .filter(member => member.enabled)
                    .map(member => member.code),
            ),
        ),
    ].sort();
    const targets: TaxTarget[] = [{}, ...countryCodes.map(countryCode => ({ countryCode }))];
    const taxZones = new Map<TaxTarget, Zone>();
    for (const target of targets) {
        const order = target.countryCode
            ? new Order({ shippingAddress: { countryCode: target.countryCode }, lines: [] })
            : undefined;
        const zone = await services.taxZoneStrategy.determineTaxZone(ctx, allZones, channel, order);
        // With no tax zone, no rate applies to anything. The default-zones check reports that.
        if (zone) {
            taxZones.set(target, zone);
        }
    }

    const categories = await services.connection
        .getRepository(ctx, TaxCategory)
        .find({ where: { id: In(categoryIds) } });
    const findings: StoreReadinessFinding[] = [];
    for (const taxCategory of categories) {
        const missing = new Map<ID, NoRateDetails>();
        for (const [target, zone] of taxZones) {
            const rate = await services.taxRateService.findApplicableTaxRate(
                ctx,
                { countryCode: target.countryCode, zone },
                taxCategory.id,
            );
            if (rate) {
                continue;
            }
            const details = missing.get(zone.id) ?? {
                channel,
                zone,
                taxCategory,
                countryCodes: [],
                withoutAddress: false,
            };
            if (target.countryCode) {
                details.countryCodes.push(target.countryCode);
            } else {
                details.withoutAddress = true;
            }
            missing.set(zone.id, details);
        }
        for (const details of missing.values()) {
            findings.push(
                toFinding(noApplicableTaxRate, 'error', details, {
                    channelId: channel.id,
                    zoneId: details.zone.id,
                    taxCategoryId: taxCategory.id,
                    dashboardUrl: '/tax-rates',
                }),
            );
        }
    }
    return findings;
}
