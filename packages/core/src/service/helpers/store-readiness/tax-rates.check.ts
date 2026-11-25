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
import { resolveTaxCountryCode } from '../utils/resolve-tax-country-code';

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

/**
 * An order to one country, or with no address, with the tax zone and tax country that the
 * configured strategy gives it.
 */
export interface TaxTarget {
    /** The shipping country of the sample order, if it has an address. */
    countryCode?: string;
    zone: Zone;
    /** The country whose country rates apply, as checkout resolves it. */
    taxCountryCode?: string;
}

/**
 * For each tax category the Channel's variants use, an order to each country the Channel ships to,
 * and an order with no address yet, get a configured tax rate. The tax zone and the tax country of
 * each order come from the configured {@link TaxZoneStrategy}, and the rate from
 * {@link TaxRateService}, as at checkout.
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
    const taxTargets = await resolveTaxTargets(input, services.taxZoneStrategy);
    const categories = await services.connection
        .getRepository(ctx, TaxCategory)
        .find({ where: { id: In(categoryIds) } });
    const findings: StoreReadinessFinding[] = [];
    for (const taxCategory of categories) {
        const missing = await findMissingRates(input, services.taxRateService, taxTargets, taxCategory);
        // When core cannot tell which rate the entered prices include, checkTaxInclusiveRates reports
        // the default tax zone, with the orders it leaves untaxed, so it is not reported twice.
        const includedRateUnknown =
            channel.pricesIncludeTax &&
            !(await services.taxRateService.findIncludedTaxRate(input.ctx, channel, taxCategory.id));
        for (const details of missing.filter(
            d => !(includedRateUnknown && isDefaultTaxZone(channel, d.zone)),
        )) {
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

function isDefaultTaxZone(channel: Channel, zone: Zone): boolean {
    return idsAreEqual(channel.defaultTaxZone?.id, zone.id);
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
 * The tax zone and tax country of an order with no address yet, and of an order to each country the
 * Channel ships to, as the configured strategy picks them. The sample orders have an empty billing
 * address, so that a strategy which reads it works as on a real order.
 */
export async function resolveTaxTargets(
    { ctx, channel, allZones, shippingZones }: ChannelReadinessInput,
    taxZoneStrategy: TaxZoneStrategy,
): Promise<TaxTarget[]> {
    const countryCodes: Array<string | undefined> = [undefined, ...shippingCountryCodes(shippingZones)];
    const targets: TaxTarget[] = [];
    for (const countryCode of countryCodes) {
        const order = countryCode
            ? new Order({ shippingAddress: { countryCode }, billingAddress: {}, lines: [] })
            : undefined;
        const zone = await taxZoneStrategy.determineTaxZone(ctx, allZones, channel, order);
        // With no tax zone, no rate applies to anything. The default-zones check reports that.
        if (zone) {
            const taxCountryCode = await resolveTaxCountryCode(taxZoneStrategy, ctx, channel, zone, order);
            targets.push({ countryCode, zone, taxCountryCode });
        }
    }
    return targets;
}

/** The orders of one tax category that get no rate, grouped by their tax zone. */
async function findMissingRates(
    { ctx, channel }: ChannelReadinessInput,
    taxRateService: TaxRateService,
    taxTargets: TaxTarget[],
    taxCategory: TaxCategory,
): Promise<NoRateDetails[]> {
    const missing = new Map<ID, NoRateDetails>();
    for (const { countryCode, zone, taxCountryCode } of taxTargets) {
        const rate = await taxRateService.findApplicableTaxRate(
            ctx,
            { countryCode: taxCountryCode, zone },
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
        if (countryCode) {
            details.countryCodes.push(countryCode);
        } else {
            details.withoutAddress = true;
        }
        missing.set(zone.id, details);
    }
    return [...missing.values()];
}
