import { OrmUtils } from 'typeorm/util/OrmUtils';
import { beforeAll, describe, expect, it } from 'vitest';

import { patchTypeOrmDeepValue } from './typeorm-deep-value-fix';

describe('patchTypeOrmDeepValue()', () => {
    beforeAll(() => {
        patchTypeOrmDeepValue();
    });

    it('reads a single-segment path', () => {
        expect(OrmUtils.deepValue({ owner: true }, 'owner')).toBe(true);
    });

    it('reads a nested path', () => {
        expect(OrmUtils.deepValue({ customFields: { owner: true } }, 'customFields.owner')).toBe(true);
    });

    it('returns undefined for a missing leaf segment', () => {
        expect(OrmUtils.deepValue({ customFields: {} }, 'customFields.owner')).toBeUndefined();
    });

    // The find options of a query for an entity with an eager relation custom field, where the
    // query asks for some other relation. Unpatched, TypeORM reads `owner` of `undefined` here.
    it('returns undefined for a missing intermediate segment', () => {
        expect(OrmUtils.deepValue({ featuredAsset: true }, 'customFields.owner')).toBeUndefined();
    });

    it('returns undefined for a null intermediate segment', () => {
        expect(OrmUtils.deepValue({ customFields: null } as any, 'customFields.owner')).toBeUndefined();
    });
});
