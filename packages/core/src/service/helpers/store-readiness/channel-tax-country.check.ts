import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';

import { idsAreEqual } from '../../../common/utils';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { Country } from '../../../entity/region/country.entity';
import { Zone } from '../../../entity/zone/zone.entity';

import {
    adminToolPath,
    ChannelReadinessInput,
    countryMembers,
    StoreReadinessFinding,
    StoreReadinessSeverity,
    toFinding,
} from './store-readiness-types';

interface TaxCountryDetails {
    channel: Channel;
    taxCountryCode: string;
}

interface TaxCountryOutsideZoneDetails extends TaxCountryDetails {
    zone: Zone;
}

export const taxCountryUnknown = defineError<TaxCountryDetails>({
    code: 'store.channel.tax-country-unknown',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel, taxCountryCode }) =>
        `Channel "${channel.code}" has the tax country "${taxCountryCode}", which is not the code of a ` +
        `country, so its tax-inclusive prices are split at the default tax zone's zone rate.`,
    fix: ({ channel }) => [
        {
            path: adminToolPath('update_channel'),
            input: { id: channel.id, input: { taxCountryCode: null } },
            description:
                'Clear the tax country, or set "taxCountryCode" to the code of the country whose rate ' +
                'the entered prices include.',
        },
    ],
});

export const taxCountryOutsideDefaultZone = defineError<TaxCountryOutsideZoneDetails>({
    code: 'store.channel.tax-country-outside-default-zone',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel, taxCountryCode, zone }) =>
        `The tax country ${taxCountryCode} of channel "${channel.code}" is not in its default tax zone ` +
        `"${zone.name}". When ${taxCountryCode} has no country rate, the entered prices are split at the ` +
        `zone rate of "${zone.name}", which is not a rate of ${taxCountryCode}.`,
    fix: ({ zone, taxCountryCode }) => [
        {
            path: adminToolPath('update_zone'),
            input: { id: zone.id },
            description:
                `Add ${taxCountryCode} to the zone "${zone.name}", as "memberCountryCodes" in "input". The ` +
                'list replaces the current members, so include any you keep. Or choose a default tax ' +
                'zone that contains it.',
        },
    ],
});

/**
 * The Channel's tax country is the code of a country, and a member of its default tax zone. The
 * code has no foreign key: `ChannelService` and `CountryService` keep it valid, so an unknown code
 * comes from data written around them. A tax country outside the default zone is allowed, because
 * a later zone edit could break the rule anyway, so it is a warning.
 */
export async function checkChannelTaxCountry(
    { ctx, channel, allZones }: ChannelReadinessInput,
    connection: TransactionalConnection,
): Promise<StoreReadinessFinding[]> {
    const { taxCountryCode } = channel;
    if (!taxCountryCode) {
        return [];
    }
    const target = { channelId: channel.id, dashboardUrl: '/channels' };
    const country = await connection.getRepository(ctx, Country).findOne({ where: { code: taxCountryCode } });
    if (!country) {
        return [
            toFinding(taxCountryUnknown, StoreReadinessSeverity.ERROR, { channel, taxCountryCode }, target),
        ];
    }
    const defaultZoneId = channel.defaultTaxZone?.id;
    const zone = allZones.find(z => idsAreEqual(z.id, defaultZoneId));
    // With no default tax zone, the default-zones check reports the channel.
    if (!zone || countryMembers(zone).some(member => member.code === taxCountryCode)) {
        return [];
    }
    return [
        toFinding(
            taxCountryOutsideDefaultZone,
            StoreReadinessSeverity.WARNING,
            { channel, taxCountryCode, zone },
            { ...target, zoneId: zone.id },
        ),
    ];
}
