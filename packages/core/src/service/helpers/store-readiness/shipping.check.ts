import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';

import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { Zone } from '../../../entity/zone/zone.entity';
import { OrderTestingService } from '../../services/order-testing.service';
import { ShippingMethodService } from '../../services/shipping-method.service';

import { sampleCountryCode } from './shipping-zones';
import {
    adminToolName,
    adminToolPath,
    ChannelReadinessInput,
    inChannel,
    StoreReadinessFinding,
    StoreReadinessSeverity,
    toFinding,
} from './store-readiness-types';
import { findSampleVariant } from './variant-queries';

export const noShippingMethod = defineError<{ channel: Channel }>({
    code: 'store.channel.no-shipping-method',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel }) => `Channel "${channel.code}" has no shipping method, so no order can ship.`,
    fix: () => [
        {
            path: adminToolPath('list_shipping_options'),
            input: {},
            description:
                'See the checkers, calculators and fulfillment handlers, then create a method with ' +
                `${adminToolName('create_shipping_method')}.`,
        },
    ],
});

export const noSellableVariant = defineError<{ channel: Channel }>({
    code: 'store.channel.no-sellable-variant',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel }) =>
        `Channel "${channel.code}" has no enabled product variant with a price in ${channel.defaultCurrencyCode}, ` +
        'so nothing can be ordered and shipping could not be checked.',
});

export const noEligibleShippingMethod = defineError<{ channel: Channel; zone: Zone; countryCode: string }>({
    code: 'store.shipping.no-eligible-method',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel, zone, countryCode }) =>
        `No shipping method of channel "${channel.code}" is eligible for an order to ${countryCode} ` +
        `(zone "${zone.name}").`,
    fix: () => [
        {
            path: adminToolPath('list_shipping_methods'),
            input: {},
            description:
                `See the methods' eligibility checkers, then change one with ${adminToolName('update_shipping_method')} ` +
                `or create a method with ${adminToolName('create_shipping_method')}.`,
        },
    ],
});

/**
 * The Channel has a shipping method, and for each Zone it ships to, one sample order to one country of
 * the Zone has at least one eligible method. The sample orders are built in memory by
 * {@link OrderTestingService} and never saved.
 */
export async function checkShipping(
    input: ChannelReadinessInput,
    services: {
        connection: TransactionalConnection;
        shippingMethodService: ShippingMethodService;
        orderTestingService: OrderTestingService;
    },
): Promise<StoreReadinessFinding[]> {
    const { ctx, newContext, channel, shippingZones } = input;
    const target = { channelId: channel.id, dashboardUrl: '/shipping-methods' };
    const inThisChannel = (finding: StoreReadinessFinding) => ({
        ...finding,
        fixes: inChannel(input, finding.fixes),
    });
    const { totalItems } = await services.shippingMethodService.findAll(ctx, { take: 1 });
    const variant = await findSampleVariant(
        ctx,
        services.connection,
        channel.id,
        channel.defaultCurrencyCode,
    );
    // Both gaps are reported together, so fixing one does not reveal the other.
    const gaps: StoreReadinessFinding[] = [];
    if (totalItems === 0) {
        gaps.push(
            inThisChannel(toFinding(noShippingMethod, StoreReadinessSeverity.ERROR, { channel }, target)),
        );
    }
    if (!variant) {
        gaps.push(
            toFinding(
                noSellableVariant,
                StoreReadinessSeverity.ERROR,
                { channel },
                { channelId: channel.id, dashboardUrl: '/products' },
            ),
        );
    }
    if (gaps.length || !variant) {
        return gaps;
    }
    const findings: StoreReadinessFinding[] = [];
    for (const zone of shippingZones) {
        const countryCode = sampleCountryCode(zone);
        if (!countryCode) {
            continue;
        }
        const quotes = await services.orderTestingService.testEligibleShippingMethods(await newContext(), {
            shippingAddress: { countryCode, streetLine1: 'Store check', city: 'Store check' },
            lines: [{ productVariantId: variant.id, quantity: 1 }],
        });
        if (quotes.length === 0) {
            findings.push(
                inThisChannel(
                    toFinding(
                        noEligibleShippingMethod,
                        StoreReadinessSeverity.ERROR,
                        { channel, zone, countryCode },
                        { ...target, zoneId: zone.id, countryCode },
                    ),
                ),
            );
        }
    }
    return findings;
}
