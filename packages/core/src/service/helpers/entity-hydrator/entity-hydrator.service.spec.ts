import { describe, expect, it } from 'vitest';

import { EntityHydrator } from './entity-hydrator.service';

describe('EntityHydrator', () => {
    describe('getRelationEntityAtPath()', () => {
        // https://github.com/vendurehq/vendure/issues/4661
        it('treats undefined intermediate relations as terminal values', () => {
            const hydrator = new EntityHydrator(undefined as any, undefined as any, undefined as any);
            const translation = { languageCode: 'en', name: 'Laptop' };
            const order = {
                lines: [
                    {
                        productVariant: {
                            translations: [translation],
                        },
                    },
                    {
                        productVariant: undefined,
                    },
                ],
            };

            const result = (hydrator as any).getRelationEntityAtPath(order, [
                'lines',
                'productVariant',
                'translations',
            ]);

            expect(result).toEqual([translation, undefined]);
        });
    });
});
