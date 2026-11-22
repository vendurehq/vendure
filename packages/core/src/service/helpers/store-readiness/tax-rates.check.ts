import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';
import { ID } from '@vendure/common/lib/shared-types';
import { In } from 'typeorm';

import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { TaxCategory } from '../../../entity/tax-category/tax-category.entity';
import { TaxRate } from '../../../entity/tax-rate/tax-rate.entity';
import { Zone } from '../../../entity/zone/zone.entity';
import { TaxRateService } from '../../services/tax-rate.service';

import { ChannelReadinessInput, StoreReadinessFinding, toFinding } from './store-readiness-types';
import { findChannelTaxCategoryIds } from './variant-queries';

/**
 * The ID of the rate that {@link TaxRateService} `getApplicableTaxRate()` falls back to when no
 * configured rate applies.
 */
const UNCONFIGURED_TAX_RATE_ID = '0';

export const noApplicableTaxRate = defineError<{
    channel: Channel;
    zone: Zone;
    taxCategory: TaxCategory;
    countryCodes: string[];
}>({
    code: 'store.tax.no-rate',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel, zone, taxCategory, countryCodes }) =>
        `No tax rate for tax category "${taxCategory.name}" applies in zone "${zone.name}" ` +
        `for ${countryCodes.join(', ')}, so products of channel "${channel.code}" in that category are taxed at 0%.`,
    fix: ({ zone, taxCategory }) => [
        {
            path: ['admin_create_tax_rate'],
            input: {
                input: {
                    name: `${taxCategory.name} ${zone.name}`,
                    taxCategoryId: taxCategory.id,
                    target: { zoneId: zone.id },
                },
            },
            description: `Add a rate for the whole zone, with its percentage as "value". A rate per country works too.`,
        },
    ],
});

/**
 * For each tax category the Channel's variants use, and each Zone the Channel ships to, a rate
 * applies to every enabled country of the Zone: a rate on the Zone, or a rate on the country.
 * The rates are resolved by {@link TaxRateService}, so this check follows the same rules as checkout.
 */
export async function checkTaxRates(
    { ctx, channel, shippingZones }: ChannelReadinessInput,
    connection: TransactionalConnection,
    taxRateService: TaxRateService,
): Promise<StoreReadinessFinding[]> {
    const categoryIds = await findChannelTaxCategoryIds(ctx, connection, channel.id);
    if (categoryIds.length === 0) {
        return [];
    }
    const categories = await connection
        .getRepository(ctx, TaxCategory)
        .find({ where: { id: In(categoryIds) } });
    const findings: StoreReadinessFinding[] = [];
    for (const taxCategory of categories) {
        for (const zone of shippingZones) {
            const countryCodes = await countriesWithoutRate(ctx, taxRateService, zone, taxCategory.id);
            if (countryCodes.length) {
                findings.push(
                    toFinding(
                        noApplicableTaxRate,
                        'error',
                        { channel, zone, taxCategory, countryCodes },
                        {
                            channelId: channel.id,
                            zoneId: zone.id,
                            taxCategoryId: taxCategory.id,
                            dashboardUrl: '/tax-rates',
                        },
                    ),
                );
            }
        }
    }
    return findings;
}

async function countriesWithoutRate(
    ctx: ChannelReadinessInput['ctx'],
    taxRateService: TaxRateService,
    zone: Zone,
    taxCategoryId: ID,
): Promise<string[]> {
    const missing: string[] = [];
    for (const member of zone.members) {
        if (!member.enabled) {
            continue;
        }
        const rate: TaxRate = await taxRateService.getApplicableTaxRate(
            ctx,
            { countryCode: member.code, zone },
            taxCategoryId,
        );
        if (String(rate.id) === UNCONFIGURED_TAX_RATE_ID) {
            missing.push(member.code);
        }
    }
    return missing.sort();
}
