import { COMMAND_EXIT_CODES, defineError } from '@vendure/common/lib/command';

import { ConfigService } from '../../../config/config.service';
import { Channel } from '../../../entity/channel/channel.entity';
import { PaymentMethodService } from '../../services/payment-method.service';

import {
    adminToolPath,
    ChannelReadinessInput,
    StoreReadinessFinding,
    toFinding,
} from './store-readiness-types';

export const noEnabledPaymentMethod = defineError<{ channel: Channel; handlerCode?: string }>({
    code: 'store.channel.no-payment-method',
    exit: COMMAND_EXIT_CODES.failed,
    message: ({ channel, handlerCode }) =>
        `Channel "${channel.code}" has no enabled payment method, so no order can be paid.` +
        (handlerCode ? '' : ' The config registers no payment handler either.'),
    fix: ({ channel, handlerCode }) =>
        handlerCode
            ? [
                  {
                      path: adminToolPath('list_payment_options'),
                      input: {},
                      description: 'See the payment handlers and the arguments each one takes.',
                  },
                  {
                      path: adminToolPath('create_payment_method'),
                      input: {
                          input: {
                              code: `${channel.code}-payment`,
                              handler: { code: handlerCode, args: {} },
                              translations: [{ languageCode: channel.defaultLanguageCode, name: 'Payment' }],
                          },
                      },
                      description: "Create a payment method. Fill in the handler's arguments.",
                  },
              ]
            : [],
});

/** The Channel has an enabled payment method. */
export async function checkPaymentMethods(
    { ctx, channel }: ChannelReadinessInput,
    paymentMethodService: PaymentMethodService,
    configService: ConfigService,
): Promise<StoreReadinessFinding[]> {
    const { totalItems } = await paymentMethodService.findAll(ctx, {
        filter: { enabled: { eq: true } },
        take: 1,
    });
    if (totalItems > 0) {
        return [];
    }
    const handlerCode = configService.paymentOptions.paymentMethodHandlers[0]?.code;
    return [
        toFinding(
            noEnabledPaymentMethod,
            'error',
            { channel, handlerCode },
            { channelId: channel.id, dashboardUrl: '/payment-methods' },
        ),
    ];
}
