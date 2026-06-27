import { describe, expect, it } from 'vitest';

import type { ConfigurableFieldDef } from './form-engine-types.js';
import { jsonStringValueTransformer } from './value-transformers.js';

const fieldDef = (overrides: Partial<ConfigurableFieldDef>): ConfigurableFieldDef =>
    ({
        name: 'test',
        type: 'string',
        list: false,
        ...overrides,
    }) as ConfigurableFieldDef;

describe('jsonStringValueTransformer', () => {
    it('does not JSON-parse scalar ID values', () => {
        const def = fieldDef({ type: 'ID' });

        expect(jsonStringValueTransformer.parse('3', def)).toBe('3');
        expect(jsonStringValueTransformer.parse('001', def)).toBe('001');
    });

    it('serializes scalar ID values as opaque strings', () => {
        const def = fieldDef({ type: 'ID' });

        expect(jsonStringValueTransformer.serialize('3', def)).toBe('3');
        expect(jsonStringValueTransformer.serialize(3, def)).toBe('3');
    });

    it('preserves JSON array serialization for list ID values', () => {
        const def = fieldDef({ type: 'ID', list: true });

        expect(jsonStringValueTransformer.serialize(['3', '4'], def)).toBe('["3","4"]');
        expect(jsonStringValueTransformer.serialize('["3","4"]', def)).toBe('["3","4"]');
    });
});
