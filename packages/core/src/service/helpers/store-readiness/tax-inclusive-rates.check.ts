import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';
import { In } from 'typeorm';

import { idsAreEqual } from '../../../common/utils';
import { TaxZoneStrategy } from '../../../config/tax/tax-zone-strategy';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { Country } from '../../../entity/region/country.entity';
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
import { resolveTaxTargets } from './tax-rates.check';
import { findChannelTaxCategoryIds } from './variant-queries';

interface InclusiveRateUnknownDetails {
    channel: Channel;
    zone: Zone;
    taxCategory: TaxCategory;
    /** The countries whose orders get the default tax zone and no rate either. */
    untaxedCountryCodes: string[];
    /** Whether an order with no address yet gets the default tax zone and no rate. */
    withoutAddress: boolean;
    /** Whether an order to a country the Channel ships to gets another tax zone. */
    shipsOutsideZone: boolean;
    /** The only enabled country of the default tax zone with a country rate for the tax category, to suggest as tax country. */
    candidateTaxCountryCode?: string;
}

export const inclusiveRateUnknown = defineError<InclusiveRateUnknownDetails>({
    code: 'store.tax.inclusive-rate-unknown',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel, zone, taxCategory, untaxedCountryCodes, withoutAddress, shipsOutsideZone }) => {
        const untaxed = [
            ...(withoutAddress ? ['orders with no address yet'] : []),
            ...(untaxedCountryCodes.length ? [`orders to ${untaxedCountryCodes.join(', ')}`] : []),
        ].join(' and ');
        const taxCountry = channel.taxCountryCode
            ? `its tax country ${channel.taxCountryCode} has no enabled country rate for it`
            : 'it has no tax country';
        return (
            `Channel "${channel.code}" has prices that include tax, but core cannot tell which rate the ` +
            `entered prices include for tax category "${taxCategory.name}": ${taxCountry}, and its ` +
            `default tax zone "${zone.name}" has no enabled zone rate for it.` +
            (untaxed ? ` In "${zone.name}", ${untaxed} are taxed at 0%.` : '') +
            (shipsOutsideZone
                ? ` Orders taxed in another zone pay that zone's tax on top of the full entered price.`
                : '')
        );
    },
    fix: ({ channel, zone, taxCategory, candidateTaxCountryCode }) => [
        ...(channel.taxCountryCode
            ? [
                  {
                      path: adminToolPath('create_tax_rate'),
                      input: {
                          input: {
                              name: `${taxCategory.name} ${channel.taxCountryCode}`,
                              taxCategoryId: taxCategory.id,
                              target: { countryCode: channel.taxCountryCode },
                          },
                      },
                      description:
                          `Add a rate for the tax country ${channel.taxCountryCode}, with the percentage ` +
                          `that the entered prices include as "value".`,
                  },
              ]
            : [
                  {
                      path: adminToolPath('update_channel'),
                      // A country is only filled in when it is the one country of the zone with a
                      // rate: otherwise the merchant chooses, as the rate splits every price.
                      input: {
                          id: channel.id,
                          input: candidateTaxCountryCode ? { taxCountryCode: candidateTaxCountryCode } : {},
                      },
                      description: candidateTaxCountryCode
                          ? `Set the tax country to ${candidateTaxCountryCode}, the only country of the zone ` +
                            `"${zone.name}" with a rate for "${taxCategory.name}", if the entered prices ` +
                            `include its rate.`
                          : `Set "taxCountryCode" to the country whose rate the entered prices include, ` +
                            `normally your own. It should be in the zone "${zone.name}" and have a country ` +
                            `rate for "${taxCategory.name}".`,
                  },
              ]),
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
                `Or add a rate for the zone "${zone.name}", with the percentage that the entered prices ` +
                `include as "value".`,
        },
    ],
});

/**
 * For a Channel whose prices include tax, every tax category its variants use has a rate that the
 * entered gross prices include, as {@link TaxRateService} `findIncludedTaxRate()` finds it: the
 * country rate of the Channel's tax country, or the zone rate of its default tax zone. Without it,
 * core cannot take the tax out for orders taxed at another rate. The price calculation makes the
 * same lookup, so the check and the prices cannot disagree. The orders that get the default tax
 * zone, and their tax countries, come from the configured {@link TaxZoneStrategy}, as in
 * `checkTaxRates`.
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
    // A tax country that is not the code of a country is reported by checkChannelTaxCountry, whose
    // fix clears it. A country rate for it could not be created, so this check waits for that fix.
    if (
        channel.taxCountryCode &&
        !(await services.connection
            .getRepository(ctx, Country)
            .findOne({ where: { code: channel.taxCountryCode } }))
    ) {
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
    const taxTargets = await resolveTaxTargets(input, services.taxZoneStrategy);
    const defaultZoneTargets = taxTargets.filter(target => idsAreEqual(target.zone.id, defaultZoneId));
    const shipsOutsideZone = taxTargets.some(
        target => target.countryCode != null && !idsAreEqual(target.zone.id, defaultZoneId),
    );
    const findings: StoreReadinessFinding[] = [];
    for (const taxCategory of categories) {
        const rate = await services.taxRateService.findIncludedTaxRate(ctx, channel, taxCategory.id);
        if (rate) {
            continue;
        }
        const untaxedCountryCodes: string[] = [];
        let withoutAddress = false;
        for (const { countryCode, taxCountryCode } of defaultZoneTargets) {
            const targetRate = await services.taxRateService.findApplicableTaxRate(
                ctx,
                { countryCode: taxCountryCode, zone },
                taxCategory.id,
            );
            if (targetRate) {
                continue;
            }
            if (countryCode == null) {
                withoutAddress = true;
            } else {
                untaxedCountryCodes.push(countryCode);
            }
        }
        const candidateTaxCountryCode = channel.taxCountryCode
            ? undefined
            : await findCandidateTaxCountry(input, services.taxRateService, zone, taxCategory);
        findings.push(
            toFinding(
                inclusiveRateUnknown,
                StoreReadinessSeverity.ERROR,
                {
                    channel,
                    zone,
                    taxCategory,
                    untaxedCountryCodes,
                    withoutAddress,
                    shipsOutsideZone,
                    candidateTaxCountryCode,
                },
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

/**
 * The one enabled country of the default tax zone with a rate for the tax category, or `undefined`
 * when there are none or several. The default zone has no zone rate here, so every rate found is a
 * country rate.
 */
async function findCandidateTaxCountry(
    { ctx }: ChannelReadinessInput,
    taxRateService: TaxRateService,
    zone: Zone,
    taxCategory: TaxCategory,
): Promise<string | undefined> {
    const withRate: string[] = [];
    for (const member of countryMembers(zone).filter(m => m.enabled)) {
        if (
            await taxRateService.findApplicableTaxRate(
                ctx,
                { countryCode: member.code, zone },
                taxCategory.id,
            )
        ) {
            withRate.push(member.code);
        }
    }
    return withRate.length === 1 ? withRate[0] : undefined;
}
