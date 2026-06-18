import { describe, expect, it } from 'vitest';

import { ConfigurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { getInitialConfigArgValue } from './configurable-operation-utils.js';

type ConfigArgDef = ConfigurableOperationDefFragment['args'][number];

const argDef = (overrides: Partial<ConfigArgDef>): ConfigArgDef =>
    ({
        name: 'test',
        type: 'string',
        required: true,
        defaultValue: null,
        list: false,
        ui: null,
        label: 'Test',
        description: null,
        ...overrides,
    }) as ConfigArgDef;

describe('getInitialConfigArgValue', () => {
    it('should initialize list args as JSON arrays', () => {
        expect(getInitialConfigArgValue(argDef({ list: true }))).toBe('[]');
        expect(getInitialConfigArgValue(argDef({ list: true, defaultValue: true }))).toBe('[true]');
    });

    it('should initialize boolean scalar args without defaults as false', () => {
        expect(getInitialConfigArgValue(argDef({ type: 'boolean' }))).toBe('false');
    });

    it('should preserve scalar defaults and empty scalar fallback', () => {
        expect(getInitialConfigArgValue(argDef({ defaultValue: 1 }))).toBe('1');
        expect(getInitialConfigArgValue(argDef({ type: 'string' }))).toBe('');
    });

    // The `!= null` guard must treat falsy-but-defined defaults (0, false, '') as
    // real values rather than absent. A naive truthy check (`if (arg.defaultValue)`)
    // would drop these and fall through to the type-based fallbacks.
    it('should preserve falsy-but-defined scalar defaults', () => {
        expect(getInitialConfigArgValue(argDef({ type: 'int', defaultValue: 0 }))).toBe('0');
        expect(getInitialConfigArgValue(argDef({ type: 'boolean', defaultValue: false }))).toBe('false');
        expect(getInitialConfigArgValue(argDef({ type: 'string', defaultValue: '' }))).toBe('');
    });

    it('should wrap falsy-but-defined list defaults in a JSON array', () => {
        expect(getInitialConfigArgValue(argDef({ list: true, defaultValue: 0 }))).toBe('[0]');
        expect(getInitialConfigArgValue(argDef({ list: true, defaultValue: false }))).toBe('[false]');
    });
});
