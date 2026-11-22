import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { UserInputError } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { DeletePaymentMethodTool } from './delete-payment-method.tool';

function tool(channelCodes: string[]) {
    const method = { id: 4, code: 'card', name: 'Card', channels: channelCodes.map(code => ({ code })) };
    const paymentMethodService = {
        findOne: vi.fn(() => Promise.resolve(method)),
        delete: vi.fn(() => Promise.resolve({ result: 'DELETED' })),
    };
    return { tool: new DeletePaymentMethodTool(paymentMethodService as any), paymentMethodService };
}

const ctxIn = (code: string) => ({ channel: { code } }) as any;

describe('delete_payment_method', () => {
    it('in another channel, says it is only removed from that channel', async () => {
        const { tool: t } = tool([DEFAULT_CHANNEL_CODE, 'eu']);
        expect(await t.describe(ctxIn('eu'), { id: 4 })).toBe(
            'Remove payment method "Card" (code card, id 4) from channel "eu". Other channels keep it.',
        );
    });

    it('in the default channel, refuses a method other channels use unless force is set', async () => {
        const { tool: t, paymentMethodService } = tool([DEFAULT_CHANNEL_CODE, 'us', 'eu']);
        const ctx = ctxIn(DEFAULT_CHANNEL_CODE);
        await expect(t.describe(ctx, { id: 4 })).rejects.toThrow(UserInputError);
        await expect(t.execute(ctx, { id: 4 })).rejects.toThrow('"eu", "us"');
        expect(paymentMethodService.delete).not.toHaveBeenCalled();
        expect(await t.describe(ctx, { id: 4, force: true })).toBe(
            'Delete payment method "Card" (code card, id 4), and remove it from the channels that also use it: "eu", "us".',
        );
    });

    it('in the default channel, deletes a method no other channel uses', async () => {
        const { tool: t } = tool([DEFAULT_CHANNEL_CODE]);
        expect(await t.describe(ctxIn(DEFAULT_CHANNEL_CODE), { id: 4 })).toBe(
            'Delete payment method "Card" (code card, id 4).',
        );
    });
});
