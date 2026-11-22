import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { describe, expect, it } from 'vitest';

import { DeletePaymentMethodTool } from './delete-payment-method.tool';

const method = { id: 4, code: 'card', name: 'Card' };

function tool(channelCodes: string[]) {
    const paymentMethodService = { findOne: () => Promise.resolve(method) } as any;
    const connection = {
        getRepository: () => ({
            findOne: () => Promise.resolve({ ...method, channels: channelCodes.map(code => ({ code })) }),
        }),
    } as any;
    return new DeletePaymentMethodTool(paymentMethodService, connection);
}

const ctxIn = (code: string) => ({ channel: { code } }) as any;

describe('delete_payment_method preview', () => {
    it('in another channel, says it is only removed from that channel', async () => {
        const preview = await tool([DEFAULT_CHANNEL_CODE, 'eu']).describe(ctxIn('eu'), {
            id: 4,
            force: true,
        });
        expect(preview).toBe(
            'Remove payment method "Card" (code card, id 4) from channel "eu". Other channels keep it.',
        );
    });

    it('in the default channel, names the channels that also use it, with and without force', async () => {
        const shared = tool([DEFAULT_CHANNEL_CODE, 'us', 'eu']);
        expect(await shared.describe(ctxIn(DEFAULT_CHANNEL_CODE), { id: 4 })).toContain(
            'Channels eu, us also use it, so it is only deleted with force.',
        );
        expect(await shared.describe(ctxIn(DEFAULT_CHANNEL_CODE), { id: 4, force: true })).toContain(
            'remove it from the channels that also use it: eu, us.',
        );
        expect(await tool([DEFAULT_CHANNEL_CODE]).describe(ctxIn(DEFAULT_CHANNEL_CODE), { id: 4 })).toBe(
            'Delete payment method "Card" (code card, id 4).',
        );
    });
});
