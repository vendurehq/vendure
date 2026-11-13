import { assertType, describe, expectTypeOf, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { Injector } from '../../common/injector';
import { Product } from '../../entity/product/product.entity';

import { CustomFieldConfig, StructFieldConfig } from './custom-field-types';

// https://github.com/vendurehq/vendure/issues/5575
// At runtime `validate` is called with `(value, injector, ctx)` for list and single fields alike,
// but the list config types only declared `value`. These type-level tests fail to compile on master.
describe('validate function of custom field configs (#5575)', () => {
    it('passes injector and ctx to validate on a list field', () => {
        assertType<CustomFieldConfig>({
            name: 'tags',
            type: 'string',
            list: true,
            validate: (value, injector, ctx) => {
                expectTypeOf(value).toEqualTypeOf<string[]>();
                expectTypeOf(injector).toEqualTypeOf<Injector>();
                expectTypeOf(ctx).toEqualTypeOf<RequestContext>();
            },
        });
    });

    it('passes injector and ctx to validate on a list relation field', () => {
        assertType<CustomFieldConfig>({
            name: 'addOns',
            type: 'relation',
            entity: Product,
            list: true,
            validate: (value, injector, ctx) => {
                expectTypeOf(injector).toEqualTypeOf<Injector>();
                expectTypeOf(ctx).toEqualTypeOf<RequestContext>();
            },
        });
    });

    it('passes injector and ctx to validate on a list field of a struct', () => {
        assertType<StructFieldConfig>({
            name: 'codes',
            type: 'string',
            list: true,
            validate: (value, injector, ctx) => {
                expectTypeOf(value).toEqualTypeOf<string[]>();
                expectTypeOf(injector).toEqualTypeOf<Injector>();
                expectTypeOf(ctx).toEqualTypeOf<RequestContext>();
            },
        });
    });

    it('types value of validate on a field without list as a single value', () => {
        assertType<CustomFieldConfig>({
            name: 'count',
            type: 'int',
            validate: value => {
                expectTypeOf(value).toEqualTypeOf<number>();
            },
        });
    });
});
