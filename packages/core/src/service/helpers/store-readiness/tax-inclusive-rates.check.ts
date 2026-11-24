import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';
import { In } from 'typeorm';

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
import { findChannelTaxCategoryIds } from './variant-queries';

interface InclusiveRateUnknownDetails {
    channel: Channel;
    zone: Zone;
    taxCategory: TaxCategory;
}

export const inclusiveRateUnknown = defineError<InclusiveRateUnknownDetails>({
    code: 'store.tax.inclusive-rate-unknown',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel, zone, taxCategory }) =>
        `Channel "${channel.code}" has prices that include tax, but its default tax zone "${zone.name}" ` +
        `has no enabled zone rate for tax category "${taxCategory.name}", so core cannot tell which ` +
        `rate the entered prices include. Outside "${zone.name}", the full entered price is charged ` +
        `as net, with tax added on top.`,
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
                `include as "value". A country rate does not count here.`,
        },
    ],
});

/**
 * For a Channel whose prices include tax, every tax category its variants use has an enabled zone
 * rate on the Channel's default tax zone. That rate tells core how much tax the entered gross price
 * holds, so that it can take the tax out for orders taxed in another zone. The lookup is the one
 * that `DefaultProductVariantPriceCalculationStrategy` makes: by zone only, so country rates do not
 * count.
 */
export async function checkTaxInclusiveRates(
    { ctx, channel }: ChannelReadinessInput,
    services: {
        connection: TransactionalConnection;
        taxRateService: TaxRateService;
    },
): Promise<StoreReadinessFinding[]> {
    const zone = channel.defaultTaxZone;
    // With no default tax zone, the default-zones check reports the channel.
    if (!channel.pricesIncludeTax || !zone) {
        return [];
    }
    const categoryIds = await findChannelTaxCategoryIds(ctx, services.connection, channel.id);
    if (categoryIds.length === 0) {
        return [];
    }
    const categories = await services.connection
        .getRepository(ctx, TaxCategory)
        .find({ where: { id: In(categoryIds) }, order: { id: 'ASC' } });
    const findings: StoreReadinessFinding[] = [];
    for (const taxCategory of categories) {
        const rate = await services.taxRateService.findApplicableTaxRate(ctx, zone, taxCategory.id);
        if (rate) {
            continue;
        }
        findings.push(
            toFinding(
                inclusiveRateUnknown,
                StoreReadinessSeverity.ERROR,
                { channel, zone, taxCategory },
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
