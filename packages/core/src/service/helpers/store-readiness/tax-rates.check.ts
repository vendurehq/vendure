import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';
import { ID } from '@vendure/common/lib/shared-types';
import { In } from 'typeorm';

import { idsAreEqual } from '../../../common/utils';
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
    StoreReadinessSeverity,
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
    input: ChannelReadinessInput,
    services: {
        connection: TransactionalConnection;
        taxRateService: TaxRateService;
        taxZoneStrategy: TaxZoneStrategy;
    },
): Promise<StoreReadinessFinding[]> {
    const { ctx, channel } = input;
    const categoryIds = await findChannelTaxCategoryIds(ctx, services.connection, channel.id);
    if (categoryIds.length === 0) {
        return [];
    }
    const taxZones = await resolveTaxZones(input, services.taxZoneStrategy);
    const categories = await services.connection
        .getRepository(ctx, TaxCategory)
        .find({ where: { id: In(categoryIds) } });
    const findings: StoreReadinessFinding[] = [];
    for (const taxCategory of categories) {
        const missing = await findMissingRates(input, services.taxRateService, taxZones, taxCategory);
        for (const details of missing.filter(d => !isTaxInclusiveDefaultZone(channel, d.zone))) {
            findings.push(
                toFinding(noApplicableTaxRate, StoreReadinessSeverity.ERROR, details, {
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

/**
 * A tax-inclusive Channel needs a zone rate on its default tax zone, and a country rate does not do.
 * `checkTaxInclusiveRates` reports that zone, so this check leaves it out rather than report it twice
 * with a fix that says a country rate would do.
 */
function isTaxInclusiveDefaultZone(channel: Channel, zone: Zone): boolean {
    return channel.pricesIncludeTax && idsAreEqual(channel.defaultTaxZone?.id, zone.id);
}

/** The enabled countries the Channel ships to, by code. */
function shippingCountryCodes(shippingZones: Zone[]): string[] {
    const codes = shippingZones.flatMap(zone =>
        countryMembers(zone)
            .filter(member => member.enabled)
            .map(member => member.code),
    );
    return [...new Set(codes)].sort((a, b) => a.localeCompare(b));
}

/**
 * The tax zone of an order with no address yet, and of an order to each country the Channel ships
 * to, as the configured strategy picks it.
 */
async function resolveTaxZones(
    { ctx, channel, allZones, shippingZones }: ChannelReadinessInput,
    taxZoneStrategy: TaxZoneStrategy,
): Promise<Map<TaxTarget, Zone>> {
    const targets: TaxTarget[] = [
        {},
        ...shippingCountryCodes(shippingZones).map(countryCode => ({ countryCode })),
    ];
    const taxZones = new Map<TaxTarget, Zone>();
    for (const target of targets) {
        const order = target.countryCode
            ? new Order({ shippingAddress: { countryCode: target.countryCode }, lines: [] })
            : undefined;
        const zone = await taxZoneStrategy.determineTaxZone(ctx, allZones, channel, order);
        // With no tax zone, no rate applies to anything. The default-zones check reports that.
        if (zone) {
            taxZones.set(target, zone);
        }
    }
    return taxZones;
}

/** The orders of one tax category that get no rate, grouped by their tax zone. */
async function findMissingRates(
    { ctx, channel }: ChannelReadinessInput,
    taxRateService: TaxRateService,
    taxZones: Map<TaxTarget, Zone>,
    taxCategory: TaxCategory,
): Promise<NoRateDetails[]> {
    const missing = new Map<ID, NoRateDetails>();
    for (const [target, zone] of taxZones) {
        const rate = await taxRateService.findApplicableTaxRate(
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
    return [...missing.values()];
}
