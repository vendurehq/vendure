import { describe, expect, it } from 'vitest';

import { ConfigModule } from './config.module';
import { RefundDestinationStrategy } from './payment/refund-destination-strategy';

/**
 * Builds a ConfigModule with just enough of a ConfigService to exercise the refund destination
 * validation, which runs at application bootstrap.
 */
function configModuleWithDestinations(refundDestinations: RefundDestinationStrategy[]): ConfigModule {
    const configService = { paymentOptions: { refundDestinations } } as any;
    return new ConfigModule(configService, {} as any);
}

function destination(code: string): RefundDestinationStrategy {
    return {
        code,
        description: [],
        isAvailable: () => true,
        createRefund: () => ({ state: 'Settled' as const }),
    };
}

function validate(module: ConfigModule) {
    // The validation runs as part of onApplicationBootstrap, which also initialises strategies and
    // therefore needs a real ModuleRef. Only the validation step is under test here.
    return (module as any).validateRefundDestinations();
}

describe('ConfigModule refund destination validation', () => {
    it('accepts distinct codes', () => {
        const module = configModuleWithDestinations([destination('store-credit'), destination('voucher')]);

        expect(() => validate(module)).not.toThrow();
    });

    it('accepts an absent refundDestinations option', () => {
        const module = configModuleWithDestinations(undefined as any);

        expect(() => validate(module)).not.toThrow();
    });

    it('rejects the reserved "default" code', () => {
        const module = configModuleWithDestinations([destination('default')]);

        expect(() => validate(module)).toThrow(/reserved/);
    });

    it('rejects duplicate codes', () => {
        const module = configModuleWithDestinations([
            destination('store-credit'),
            destination('store-credit'),
        ]);

        expect(() => validate(module)).toThrow(/Duplicate RefundDestinationStrategy code/);
    });
});
