import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';

import { Zone } from '../../../entity/zone/zone.entity';

import {
    adminToolPath,
    countryMembers,
    StoreReadinessFinding,
    StoreReadinessSeverity,
    toFinding,
} from './store-readiness-types';

export const zoneWithoutEnabledCountry = defineError<{ zone: Zone }>({
    code: 'store.zone.no-enabled-country',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ zone }) =>
        `Zone "${zone.name}" has no enabled country, so no order can ship to it or be taxed by it.`,
    fix: ({ zone }) => {
        const codes = countryMembers(zone).map(member => member.code);
        return codes.length
            ? [
                  {
                      path: adminToolPath('enable_countries'),
                      input: { codes },
                      description: `Enable the countries of zone "${zone.name}" that you sell to.`,
                  },
              ]
            : [
                  {
                      path: adminToolPath('update_zone'),
                      input: { id: zone.id },
                      description:
                          `Add the countries zone "${zone.name}" covers, as "memberCountryCodes" in "input". ` +
                          'The list replaces the current members, so include any you keep.',
                  },
              ];
    },
});

/**
 * A Channel has no list of the Zones it ships to, so every Zone with at least one enabled country
 * counts. A Zone with none is reported as a warning, because it covers no address.
 */
export function findShippingZones(zones: Zone[]): {
    shippingZones: Zone[];
    findings: StoreReadinessFinding[];
} {
    const shippingZones: Zone[] = [];
    const findings: StoreReadinessFinding[] = [];
    for (const zone of zones) {
        if (countryMembers(zone).some(member => member.enabled)) {
            shippingZones.push(zone);
        } else {
            findings.push(
                toFinding(
                    zoneWithoutEnabledCountry,
                    StoreReadinessSeverity.WARNING,
                    { zone },
                    { zoneId: zone.id, dashboardUrl: '/zones' },
                ),
            );
        }
    }
    return { shippingZones, findings };
}

/** The first enabled country of the Zone, ordered by code, so repeated checks use the same one. */
export function sampleCountryCode(zone: Zone): string | undefined {
    return countryMembers(zone)
        .filter(member => member.enabled)
        .map(member => member.code)
        .sort((a, b) => a.localeCompare(b))[0];
}
