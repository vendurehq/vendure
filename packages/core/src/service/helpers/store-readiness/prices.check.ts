import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';
import { CurrencyCode } from '@vendure/common/lib/generated-types';

import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { ProductVariantPrice } from '../../../entity/product-variant/product-variant-price.entity';

import { ChannelReadinessInput, StoreReadinessFinding, toFinding } from './store-readiness-types';
import { countChannelVariants } from './variant-queries';

export const missingPrices = defineError<{ channel: Channel; currencyCode: CurrencyCode; missing: number }>({
    code: 'store.channel.missing-prices',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel, currencyCode, missing }) =>
        `${missing} product variant(s) in channel "${channel.code}" have no price in ${currencyCode}, ` +
        `so they cannot be bought in that currency.`,
});

/** Every currency of the Channel has a price for every variant of the Channel. */
export async function checkPrices(
    { ctx, channel }: ChannelReadinessInput,
    connection: TransactionalConnection,
): Promise<StoreReadinessFinding[]> {
    const total = await countChannelVariants(ctx, connection, channel.id);
    if (total === 0) {
        return [];
    }
    const currencies = new Set([channel.defaultCurrencyCode, ...(channel.availableCurrencyCodes ?? [])]);
    const findings: StoreReadinessFinding[] = [];
    for (const currencyCode of currencies) {
        // One query per currency, counting the priced variants together rather than variant by variant.
        const priced = await connection
            .getRepository(ctx, ProductVariantPrice)
            .createQueryBuilder('price')
            .innerJoin('price.variant', 'variant')
            .innerJoin('variant.channels', 'channel', 'channel.id = :channelId', { channelId: channel.id })
            .where('price.channelId = :channelId', { channelId: channel.id })
            .andWhere('price.currencyCode = :currencyCode', { currencyCode })
            .andWhere('variant.deletedAt IS NULL')
            .select('COUNT(DISTINCT price.variantId)', 'count')
            .getRawOne<{ count: string | number }>();
        const missing = total - Number(priced?.count ?? 0);
        if (missing > 0) {
            findings.push(
                toFinding(
                    missingPrices,
                    'error',
                    { channel, currencyCode, missing },
                    { channelId: channel.id, dashboardUrl: '/products' },
                ),
            );
        }
    }
    return findings;
}
