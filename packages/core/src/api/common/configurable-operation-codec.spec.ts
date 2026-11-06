import { LanguageCode } from '@vendure/common/lib/generated-types';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConfigService } from '../../config/config.service';
import { MockConfigService } from '../../config/config.service.mock';
import { AutoIncrementIdStrategy } from '../../config/entity/auto-increment-id-strategy';
import { EntityIdStrategy } from '../../config/entity/entity-id-strategy';
import { UuidIdStrategy } from '../../config/entity/uuid-id-strategy';
import { PromotionCondition } from '../../config/promotion/promotion-condition';

import { ConfigurableOperationCodec } from './configurable-operation-codec';
import { IdCodecService } from './id-codec.service';

/**
 * A minimal PromotionCondition def exercising all three arg shapes the codec cares
 * about: a non-list `ID`, a list `ID`, and a non-ID arg (which must be left alone).
 */
const testCondition = new PromotionCondition({
    code: 'test_condition',
    description: [{ languageCode: LanguageCode.en, value: 'test' }],
    args: {
        singleId: { type: 'ID' },
        manyIds: { type: 'ID', list: true },
        label: { type: 'string' },
    },
    check: () => true,
});

function createCodec(idStrategy: EntityIdStrategy<any>): ConfigurableOperationCodec {
    const configService = new MockConfigService() as unknown as ConfigService;
    (configService as any).entityIdStrategy = idStrategy;
    (configService as any).entityOptions = {};
    configService.promotionOptions.promotionConditions = [testCondition];
    const idCodecService = new IdCodecService(configService);
    return new ConfigurableOperationCodec(configService, idCodecService);
}

describe('ConfigurableOperationCodec', () => {
    describe('encodeConfigurableOperationIds()', () => {
        // #4886: a non-list ID must be encoded *raw* (no JSON.stringify), so that a
        // read → save round-trip does not re-quote the id. Decode reads raw since
        // #2483, so encode must be symmetric.
        it('encodes a non-list ID as a raw string with AutoIncrementIdStrategy', () => {
            const codec = createCodec(new AutoIncrementIdStrategy());

            const [result] = codec.encodeConfigurableOperationIds(PromotionCondition, [
                { code: 'test_condition', args: [{ name: 'singleId', value: '1' }] },
            ] as any);

            // bare '1', NOT '"1"'
            expect(result.args[0].value).toBe('1');
        });

        it('encodes a non-list ID as a raw string with UuidIdStrategy', () => {
            const codec = createCodec(new UuidIdStrategy());
            const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

            const [result] = codec.encodeConfigurableOperationIds(PromotionCondition, [
                { code: 'test_condition', args: [{ name: 'singleId', value: uuid }] },
            ] as any);

            // bare uuid, NOT '"<uuid>"' — the pre-fix double-quoting also corrupted uuids
            expect(result.args[0].value).toBe(uuid);
        });

        it('still JSON-stringifies a list of IDs', () => {
            const codec = createCodec(new AutoIncrementIdStrategy());

            const [result] = codec.encodeConfigurableOperationIds(PromotionCondition, [
                { code: 'test_condition', args: [{ name: 'manyIds', value: JSON.stringify(['1', '2']) }] },
            ] as any);

            expect(result.args[0].value).toBe(JSON.stringify(['1', '2']));
        });

        it('leaves non-ID args untouched', () => {
            const codec = createCodec(new AutoIncrementIdStrategy());

            const [result] = codec.encodeConfigurableOperationIds(PromotionCondition, [
                { code: 'test_condition', args: [{ name: 'label', value: 'hello' }] },
            ] as any);

            expect(result.args[0].value).toBe('hello');
        });
    });

    describe('encode → decode round-trip', () => {
        // The regression guard for #4856: a value that has been encoded (as it is when
        // sent to the client) must decode back to the original raw primary key, with no
        // quote accumulation. Before the fix, encode produced '"1"' / '"<uuid>"' which
        // decode then mis-read (AutoIncrement → -1, uuid → still-quoted).
        function roundTrips(idStrategy: EntityIdStrategy<any>, rawId: string) {
            const codec = createCodec(idStrategy);

            const [encoded] = codec.encodeConfigurableOperationIds(PromotionCondition, [
                { code: 'test_condition', args: [{ name: 'singleId', value: rawId }] },
            ] as any);
            const [decoded] = codec.decodeConfigurableOperationIds(PromotionCondition, [
                { code: 'test_condition', arguments: [{ name: 'singleId', value: encoded.args[0].value }] },
            ] as any);

            return decoded.arguments[0].value;
        }

        it('round-trips a non-list ID with AutoIncrementIdStrategy', () => {
            expect(roundTrips(new AutoIncrementIdStrategy(), '1')).toBe(1);
        });

        it('round-trips a non-list ID with UuidIdStrategy', () => {
            const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
            expect(roundTrips(new UuidIdStrategy(), uuid)).toBe(uuid);
        });
    });
});
