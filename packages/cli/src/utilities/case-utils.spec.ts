import { describe, expect, it } from 'vitest';

import { camelCase, constantCase, kebabCase, pascalCase } from './case-utils';

// Test cases lifted from the upstream camel-case, pascal-case, param-case,
// and constant-case packages (change-case v4 sub-packages, MIT-licensed).
// Vendoring these helpers requires we preserve the same behaviour so any
// pre-existing CLI scaffolding output is unchanged.

describe('camelCase', () => {
    const cases: Array<[string, string]> = [
        ['', ''],
        ['test', 'test'],
        ['test string', 'testString'],
        ['Test String', 'testString'],
        ['TestV2', 'testV2'],
        ['_foo_bar_', 'fooBar'],
        ['version 1.2.10', 'version_1_2_10'],
        ['version 1.21.0', 'version_1_21_0'],
    ];
    for (const [input, expected] of cases) {
        it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
            expect(camelCase(input)).toBe(expected);
        });
    }
});

describe('pascalCase', () => {
    const cases: Array<[string, string]> = [
        ['', ''],
        ['test', 'Test'],
        ['test string', 'TestString'],
        ['Test String', 'TestString'],
        ['TestV2', 'TestV2'],
        ['version 1.2.10', 'Version_1_2_10'],
        ['version 1.21.0', 'Version_1_21_0'],
    ];
    for (const [input, expected] of cases) {
        it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
            expect(pascalCase(input)).toBe(expected);
        });
    }
});

describe('kebabCase', () => {
    const cases: Array<[string, string]> = [
        ['', ''],
        ['test', 'test'],
        ['test string', 'test-string'],
        ['Test String', 'test-string'],
        ['TestV2', 'test-v2'],
        ['version 1.2.10', 'version-1-2-10'],
        ['version 1.21.0', 'version-1-21-0'],
    ];
    for (const [input, expected] of cases) {
        it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
            expect(kebabCase(input)).toBe(expected);
        });
    }
});

describe('constantCase', () => {
    const cases: Array<[string, string]> = [
        ['', ''],
        ['test', 'TEST'],
        ['test string', 'TEST_STRING'],
        ['Test String', 'TEST_STRING'],
        ['dot.case', 'DOT_CASE'],
        ['path/case', 'PATH_CASE'],
        ['TestV2', 'TEST_V2'],
        ['version 1.2.10', 'VERSION_1_2_10'],
        ['version 1.21.0', 'VERSION_1_21_0'],
    ];
    for (const [input, expected] of cases) {
        it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
            expect(constantCase(input)).toBe(expected);
        });
    }
});

// Vendure-specific inputs that the CLI's `add` commands feed through these
// helpers. The shapes here are taken from the actual call sites
// (create-new-plugin.ts, add-entity.ts, add-job-queue.ts, etc.).
describe('Vendure CLI input shapes', () => {
    it('camelCase: handles plugin/service-style names', () => {
        expect(camelCase('Reviews')).toBe('reviews');
        expect(camelCase('MyJobQueue')).toBe('myJobQueue');
        expect(camelCase('invoice-plugin')).toBe('invoicePlugin');
    });

    it('pascalCase: handles plugin/service-style names', () => {
        expect(pascalCase('reviews')).toBe('Reviews');
        expect(pascalCase('my-service')).toBe('MyService');
        expect(pascalCase('image-resize-plugin')).toBe('ImageResizePlugin');
        // Idempotent for already-PascalCase input
        expect(pascalCase('MyPlugin')).toBe('MyPlugin');
    });

    it('kebabCase: handles plugin directory names', () => {
        expect(kebabCase('Reviews')).toBe('reviews');
        expect(kebabCase('ImageResizePlugin')).toBe('image-resize-plugin');
        expect(kebabCase('my service')).toBe('my-service');
        // Idempotent for already-kebab-case input
        expect(kebabCase('image-resize')).toBe('image-resize');
    });

    it('kebabCase: handles service-name inputs from getServiceFilePath', () => {
        // add-service.ts:270 does `kebabCase(serviceName).replace(/-service$/, '.service')`
        expect(kebabCase('MyService')).toBe('my-service');
        expect(kebabCase('ImageResizeService')).toBe('image-resize-service');
    });

    it('constantCase: handles plugin options token names', () => {
        // Used as e.g. `pluginInitOptionsName: constantCase(name) + '_OPTIONS'`
        expect(constantCase('ImageResizePlugin')).toBe('IMAGE_RESIZE_PLUGIN');
        expect(constantCase('reviews-plugin')).toBe('REVIEWS_PLUGIN');
    });
});
