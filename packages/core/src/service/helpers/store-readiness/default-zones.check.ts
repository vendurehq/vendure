import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';

import { Channel } from '../../../entity/channel/channel.entity';
import { Zone } from '../../../entity/zone/zone.entity';

import {
    adminToolPath,
    ChannelReadinessInput,
    StoreReadinessFinding,
    toFinding,
} from './store-readiness-types';

interface DefaultZoneDetails {
    channel: Channel;
    /** A Zone the fix can suggest, when the Channel ships anywhere. */
    candidate?: Zone;
}

function setZoneFix(field: 'defaultTaxZoneId' | 'defaultShippingZoneId', details: DefaultZoneDetails) {
    if (!details.candidate) {
        return [];
    }
    return [
        {
            path: adminToolPath('update_channel'),
            input: { id: details.channel.id, input: { [field]: details.candidate.id } },
            description: `Use the zone "${details.candidate.name}", or another zone from admin_list_zones.`,
        },
    ];
}

export const noDefaultTaxZone = defineError<DefaultZoneDetails>({
    code: 'store.channel.no-default-tax-zone',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel }) =>
        `Channel "${channel.code}" has no default tax zone, so tax cannot be calculated before an order has an address.`,
    fix: details => setZoneFix('defaultTaxZoneId', details),
});

export const noDefaultShippingZone = defineError<DefaultZoneDetails>({
    code: 'store.channel.no-default-shipping-zone',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel }) => `Channel "${channel.code}" has no default shipping zone.`,
    fix: details => setZoneFix('defaultShippingZoneId', details),
});

/** The Channel has a default tax Zone and a default shipping Zone. */
export function checkDefaultZones({
    channel,
    shippingZones,
}: ChannelReadinessInput): StoreReadinessFinding[] {
    const findings: StoreReadinessFinding[] = [];
    // The Dashboard routes on API IDs, which an EntityIdStrategy may encode, so the link is to the list.
    const target = { channelId: channel.id, dashboardUrl: '/channels' };
    const details = { channel, candidate: shippingZones[0] };
    if (!channel.defaultTaxZone) {
        findings.push(toFinding(noDefaultTaxZone, 'error', details, target));
    }
    if (!channel.defaultShippingZone) {
        findings.push(toFinding(noDefaultShippingZone, 'error', details, target));
    }
    return findings;
}
