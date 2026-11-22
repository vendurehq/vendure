import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';

import { Channel } from '../../../entity/channel/channel.entity';
import { StockLocationService } from '../../services/stock-location.service';

import {
    adminToolPath,
    ChannelReadinessInput,
    inChannel,
    StoreReadinessFinding,
    StoreReadinessSeverity,
    toFinding,
} from './store-readiness-types';

export const noStockLocation = defineError<{ channel: Channel }>({
    code: 'store.channel.no-stock-location',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel }) =>
        `Channel "${channel.code}" has no stock location, so stock cannot be allocated to its orders.`,
    fix: () => [
        {
            path: adminToolPath('create_stock_location'),
            input: { input: { name: 'Default stock location' } },
            description: 'Create a stock location in the active channel.',
        },
    ],
});

/** The Channel has a stock location assigned. */
export async function checkStockLocations(
    input: ChannelReadinessInput,
    stockLocationService: StockLocationService,
): Promise<StoreReadinessFinding[]> {
    const { ctx, channel } = input;
    const { totalItems } = await stockLocationService.findAll(ctx, { take: 1 });
    if (totalItems > 0) {
        return [];
    }
    const finding = toFinding(
        noStockLocation,
        StoreReadinessSeverity.ERROR,
        { channel },
        { channelId: channel.id, dashboardUrl: '/stock-locations' },
    );
    return [{ ...finding, fixes: inChannel(input, finding.fixes) }];
}
