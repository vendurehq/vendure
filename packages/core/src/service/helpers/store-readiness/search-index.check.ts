import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';

import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { SearchIndexItem } from '../../../plugin/default-search-plugin/entities/search-index-item.entity';

import {
    ChannelReadinessInput,
    StoreReadinessFinding,
    StoreReadinessSeverity,
    toFinding,
} from './store-readiness-types';
import { countChannelVariants } from './variant-queries';

export const searchIndexIncomplete = defineError<{ channel: Channel; indexed: number; variants: number }>({
    code: 'store.search.index-incomplete',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel, indexed, variants }) =>
        `The search index of channel "${channel.code}" holds ${indexed} of its ${variants} product variant(s), ` +
        'so customers cannot find the rest. Rebuild the search index.',
});

/**
 * The search index holds every variant of the Channel, in the Channel's default language. The check
 * reads the DefaultSearchPlugin's index. With another search plugin it finds nothing to compare and
 * reports nothing, so a store is never flagged by mistake.
 */
export async function checkSearchIndex(
    { ctx, channel }: ChannelReadinessInput,
    connection: TransactionalConnection,
): Promise<StoreReadinessFinding[]> {
    if (!connection.rawConnection.hasMetadata(SearchIndexItem)) {
        return [];
    }
    const variants = await countChannelVariants(ctx, connection, channel.id);
    const indexed = await connection
        .getRepository(ctx, SearchIndexItem)
        .createQueryBuilder('item')
        .where('item.channelId = :channelId', { channelId: channel.id })
        .andWhere('item.languageCode = :languageCode', { languageCode: channel.defaultLanguageCode })
        .getCount();
    if (indexed >= variants) {
        return [];
    }
    return [
        toFinding(
            searchIndexIncomplete,
            StoreReadinessSeverity.WARNING,
            { channel, indexed, variants },
            { channelId: channel.id, dashboardUrl: '/products' },
        ),
    ];
}
