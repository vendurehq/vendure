import {
    ConfigurableOperation,
    getDefaultConfigArgValue,
    toConfigurableOperationInput,
} from '@vendure/admin-ui/core';

describe('getDefaultConfigArgValue()', () => {
    it('returns a default string value', () => {
        const value = getDefaultConfigArgValue({
            name: 'test',
            type: 'string',
            defaultValue: 'foo',
            list: false,
            required: false,
        });

        expect(value).toBe('foo');
    });

    it('returns a default empty string value', () => {
        const value = getDefaultConfigArgValue({
            name: 'test',
            type: 'string',
            defaultValue: '',
            list: false,
            required: false,
        });

        expect(value).toBe('');
    });

    it('returns a default number value', () => {
        const value = getDefaultConfigArgValue({
            name: 'test',
            type: 'float',
            defaultValue: 2.5,
            list: false,
            required: false,
        });

        expect(value).toBe(2.5);
    });

    it('returns a default zero number value', () => {
        const value = getDefaultConfigArgValue({
            name: 'test',
            type: 'float',
            defaultValue: 0,
            list: false,
            required: false,
        });

        expect(value).toBe(0);
    });

    it('returns a default list value', () => {
        const value = getDefaultConfigArgValue({
            name: 'test',
            type: 'float',
            list: true,
            required: false,
        });

        expect(value).toEqual([]);
    });

    it('returns a null if no default set', () => {
        function getValueForType(type: string) {
            return getDefaultConfigArgValue({
                name: 'test',
                type,
                list: false,
                required: false,
            });
        }
        expect(getValueForType('string')).toBeNull();
        expect(getValueForType('datetime')).toBeNull();
        expect(getValueForType('float')).toBeNull();
        expect(getValueForType('ID')).toBeNull();
        expect(getValueForType('int')).toBeNull();
    });

    it('returns false for boolean without default', () => {
        const value = getDefaultConfigArgValue({
            name: 'test',
            type: 'boolean',
            list: false,
            required: false,
        });

        expect(value).toBe(false);
    });
});

describe('toConfigurableOperationInput()', () => {
    const configOp: ConfigurableOperation = {
        code: 'test',
        args: [
            {
                name: 'option1',
                value: 'value1',
            },
            {
                name: 'option2',
                value: 'value2',
            },
        ],
    };
    it('returns correct structure', () => {
        const value = toConfigurableOperationInput(configOp, {
            args: { option1: 'value1-2', option2: 'value2-2' },
        });
        expect(value).toEqual({
            code: 'test',
            arguments: [
                {
                    name: 'option1',
                    value: 'value1-2',
                },
                {
                    name: 'option2',
                    value: 'value2-2',
                },
            ],
        });
    });

    it('works with out-of-order args', () => {
        const value = toConfigurableOperationInput(configOp, {
            args: { option2: 'value2-2', option1: 'value1-2' },
        });
        expect(value).toEqual({
            code: 'test',
            arguments: [
                {
                    name: 'option1',
                    value: 'value1-2',
                },
                {
                    name: 'option2',
                    value: 'value2-2',
                },
            ],
        });
    });

    it('works with array input', () => {
        const value = toConfigurableOperationInput(configOp, {
            args: [
                { name: 'option2', value: 'value2-2' },
                { name: 'option1', value: 'value1-2' },
            ],
        });
        expect(value).toEqual({
            code: 'test',
            arguments: [
                {
                    name: 'option1',
                    value: 'value1-2',
                },
                {
                    name: 'option2',
                    value: 'value2-2',
                },
            ],
        });
    });
});
