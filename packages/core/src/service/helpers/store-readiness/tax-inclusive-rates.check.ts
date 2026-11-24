import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';
import { In } from 'typeorm';

import { idsAreEqual } from '../../../common/utils';
import { TaxZoneStrategy } from '../../../config/tax/tax-zone-strategy';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { TaxCategory } from '../../../entity/tax-category/tax-category.entity';
import { Zone } from '../../../entity/zone/zone.entity';
import { TaxRateService } from '../../services/tax-rate.service';

import {
    adminToolPath,
    ChannelReadinessInput,
    StoreReadinessFinding,
    StoreReadinessSeverity,
    toFinding,
} from './store-readiness-types';
import { resolveTaxZones } from './tax-rates.check';
import { findChannelTaxCategoryIds } from './variant-queries';

interface InclusiveRateUnknownDetails {
    channel: Channel;
    zone: Zone;
    taxCategory: TaxCategory;
    /** The countries whose orders get the default tax zone and have no country rate either. */
    untaxedCountryCodes: string[];
    /** Whether an order with no address yet gets the default tax zone. */
    withoutAddress: boolean;
    /** Whether an order to a country the Channel ships to gets another tax zone. */
    shipsOutsideZone: boolean;
}

export const inclusiveRateUnknown = defineError<InclusiveRateUnknownDetails>({
    code: 'store.tax.inclusive-rate-unknown',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel, zone, taxCategory, untaxedCountryCodes, withoutAddress, shipsOutsideZone }) => {
        const untaxed = [
            ...(withoutAddress ? ['orders with no address yet'] : []),
            ...(untaxedCountryCodes.length ? [`orders to ${untaxedCountryCodes.join(', ')}`] : []),
        ].join(' and ');
        return (
            `Channel "${channel.code}" has prices that include tax, but its default tax zone ` +
            `"${zone.name}" has no enabled zone rate for tax category "${taxCategory.name}", so core ` +
            `cannot tell which rate the entered prices include.` +
            (untaxed ? ` In "${zone.name}", ${untaxed} are taxed at 0%.` : '') +
            (shipsOutsideZone
                ? ` Orders taxed in another zone pay that zone's tax on top of the full entered price.`
                : '')
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
            description:
                `Add a rate for the zone "${zone.name}", with the percentage that the entered prices ` +
                `include as "value". A country rate is not enough here.`,
        },
    ],
});

/**
 * For a Channel whose prices include tax, every tax category its variants use has an enabled zone
 * rate on the Channel's default tax zone. That rate tells core how much tax the entered gross price
 * holds, so that it can take the tax out for orders taxed in another zone. The lookup is the one
 * that `DefaultProductVariantPriceCalculationStrategy` makes: by zone only, so country rates do not
 * count. The orders that get the default tax zone come from the configured {@link TaxZoneStrategy},
 * as in `checkTaxRates`.
 */
export async function checkTaxInclusiveRates(
    input: ChannelReadinessInput,
    services: {
        connection: TransactionalConnection;
        taxRateService: TaxRateService;
        taxZoneStrategy: TaxZoneStrategy;
    },
): Promise<StoreReadinessFinding[]> {
    const { ctx, channel, allZones } = input;
    const defaultZoneId = channel.defaultTaxZone?.id;
    // With no default tax zone, the default-zones check reports the channel.
    if (!channel.pricesIncludeTax || defaultZoneId == null) {
        return [];
    }
    const zone = allZones.find(z => idsAreEqual(z.id, defaultZoneId)) ?? channel.defaultTaxZone;
    const categoryIds = await findChannelTaxCategoryIds(ctx, services.connection, channel.id);
    if (categoryIds.length === 0) {
        return [];
    }
    const categories = await services.connection
        .getRepository(ctx, TaxCategory)
        .find({ where: { id: In(categoryIds) }, order: { id: 'ASC' } });
    const taxZones = await resolveTaxZones(input, services.taxZoneStrategy);
    const defaultZoneTargets = [...taxZones]
        .filter(([, taxZone]) => idsAreEqual(taxZone.id, defaultZoneId))
        .map(([target]) => target);
    const withoutAddress = defaultZoneTargets.some(target => target.countryCode == null);
    const shipsOutsideZone = [...taxZones].some(
        ([target, taxZone]) => target.countryCode != null && !idsAreEqual(taxZone.id, defaultZoneId),
    );
    const findings: StoreReadinessFinding[] = [];
    for (const taxCategory of categories) {
        const rate = await services.taxRateService.findApplicableTaxRate(ctx, zone, taxCategory.id);
        if (rate) {
            continue;
        }
        const untaxedCountryCodes: string[] = [];
        for (const { countryCode } of defaultZoneTargets) {
            if (countryCode == null) {
                continue;
            }
            const countryRate = await services.taxRateService.findApplicableTaxRate(
                ctx,
                { countryCode, zone },
                taxCategory.id,
            );
            if (!countryRate) {
                untaxedCountryCodes.push(countryCode);
            }
        }
        findings.push(
            toFinding(
                inclusiveRateUnknown,
                StoreReadinessSeverity.ERROR,
                { channel, zone, taxCategory, untaxedCountryCodes, withoutAddress, shipsOutsideZone },
                {
                    channelId: channel.id,
                    zoneId: zone.id,
                    taxCategoryId: taxCategory.id,
                    dashboardUrl: '/tax-rates',
                },
            ),
        );
    }
    return findings;
}
