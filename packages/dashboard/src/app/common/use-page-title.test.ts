import React from 'react';
import { describe, expect, it } from 'vitest';

import { normalizeBreadcrumb } from './use-page-title.js';

describe('normalizeBreadcrumb', () => {
    describe('null and undefined handling', () => {
        it('should return empty string for null', () => {
            expect(normalizeBreadcrumb(null)).toBe('');
        });

        it('should return empty string for undefined', () => {
            expect(normalizeBreadcrumb(undefined)).toBe('');
        });

        it('should return empty string for empty array', () => {
            expect(normalizeBreadcrumb([])).toBe('');
        });
    });

    describe('string handling', () => {
        it('should return string as-is', () => {
            expect(normalizeBreadcrumb('Home')).toBe('Home');
        });

        it('should return empty string as-is', () => {
            expect(normalizeBreadcrumb('')).toBe('');
        });

        it('should handle strings with special characters', () => {
            expect(normalizeBreadcrumb('Settings & Config')).toBe('Settings & Config');
        });
    });

    describe('number handling', () => {
        it('should convert number to string', () => {
            expect(normalizeBreadcrumb(42)).toBe('42');
        });

        it('should handle zero', () => {
            expect(normalizeBreadcrumb(0)).toBe('0');
        });

        it('should handle negative numbers', () => {
            expect(normalizeBreadcrumb(-123)).toBe('-123');
        });

        it('should handle decimal numbers', () => {
            expect(normalizeBreadcrumb(3.14)).toBe('3.14');
        });
    });

    describe('function handling', () => {
        it('should call function and normalize the result', () => {
            const fn = () => 'Dashboard';
            expect(normalizeBreadcrumb(fn)).toBe('Dashboard');
        });

        it('should handle nested function returns', () => {
            const fn = () => () => 'Nested Function';
            expect(normalizeBreadcrumb(fn)).toBe('Nested Function');
        });

        it('should handle function returning React element', () => {
            const mockReactElement = React.createElement('div', {}, 'React Content');
            const fn = () => mockReactElement;
            expect(normalizeBreadcrumb(fn)).toBe('React Content');
        });

        it('should handle function returning array', () => {
            const fn = () => ['First', 'Second', 'Third'];
            expect(normalizeBreadcrumb(fn)).toBe('Third');
        });

        it('should handle function returning object with label', () => {
            const fn = () => ({ label: 'Settings', path: '/settings' });
            expect(normalizeBreadcrumb(fn)).toBe('Settings');
        });
    });

    describe('array handling', () => {
        it('should return last element of string array', () => {
            expect(normalizeBreadcrumb(['Home', 'Products', 'Details'])).toBe('Details');
        });

        it('should handle single element array', () => {
            expect(normalizeBreadcrumb(['Single'])).toBe('Single');
        });

        it('should handle array with React element at the end', () => {
            const mockReactElement = React.createElement('span', {}, 'Last Item');
            expect(normalizeBreadcrumb(['First', mockReactElement])).toBe('Last Item');
        });

        it('should handle array with object containing label at the end', () => {
            const breadcrumbs = [
                'Home',
                { label: 'Products', path: '/products' },
                { label: 'Details', path: '/products/123' },
            ];
            expect(normalizeBreadcrumb(breadcrumbs)).toBe('Details');
        });

        it('should handle array with function at the end', () => {
            const breadcrumbs = ['Home', () => 'Dynamic Content'];
            expect(normalizeBreadcrumb(breadcrumbs)).toBe('Dynamic Content');
        });

        it('should handle nested arrays', () => {
            const breadcrumbs = ['First', ['Nested1', 'Nested2']];
            expect(normalizeBreadcrumb(breadcrumbs)).toBe('Nested2');
        });
    });

    describe('object with label property handling', () => {
        it('should extract string label from object', () => {
            const breadcrumb = { label: 'Settings', path: '/settings' };
            expect(normalizeBreadcrumb(breadcrumb)).toBe('Settings');
        });

        it('should handle React element as label', () => {
            const mockReactElement = React.createElement('span', {}, 'Global Settings');
            const breadcrumb = { label: mockReactElement, path: '/global-settings' };
            expect(normalizeBreadcrumb(breadcrumb)).toBe('Global Settings');
        });

        it('should handle function as label', () => {
            const breadcrumb = {
                label: () => 'Dynamic Label',
                path: '/dynamic',
            };
            expect(normalizeBreadcrumb(breadcrumb)).toBe('Dynamic Label');
        });

        it('should handle nested object with label', () => {
            const breadcrumb = {
                label: {
                    label: 'Nested Label',
                },
                path: '/nested',
            };
            expect(normalizeBreadcrumb(breadcrumb)).toBe('Nested Label');
        });

        it('should handle object with label containing array', () => {
            const breadcrumb = {
                label: ['First', 'Second', 'Third'],
                path: '/array-label',
            };
            expect(normalizeBreadcrumb(breadcrumb)).toBe('Third');
        });
    });

    describe('React element handling', () => {
        it('should extract text from simple React element', () => {
            const element = React.createElement('div', {}, 'Simple Text');
            expect(normalizeBreadcrumb(element)).toBe('Simple Text');
        });

        it('should handle nested React elements', () => {
            const innerElement = React.createElement('span', {}, 'Nested Text');
            const element = React.createElement('div', {}, innerElement);
            expect(normalizeBreadcrumb(element)).toBe('Nested Text');
        });

        it('should handle React element with array of children', () => {
            const element = React.createElement('div', {}, ['Part 1', ' ', 'Part 2']);
            expect(normalizeBreadcrumb(element)).toBe('Part 1 Part 2');
        });

        it('should handle React element with mixed children types', () => {
            const nestedElement = React.createElement('span', {}, ' nested');
            const element = React.createElement('div', {}, ['Text', 42, nestedElement]);
            expect(normalizeBreadcrumb(element)).toBe('Text42 nested');
        });
    });

    describe('complex nested scenarios', () => {
        it('should handle array with object containing function returning React element', () => {
            const mockReactElement = React.createElement('div', {}, 'Complex Content');
            const breadcrumb = [
                'Home',
                {
                    label: () => mockReactElement,
                    path: '/complex',
                },
            ];
            expect(normalizeBreadcrumb(breadcrumb)).toBe('Complex Content');
        });

        it('should handle function returning array with object containing React element', () => {
            const mockReactElement = React.createElement('div', {}, 'Deep Nested');
            const fn = () => ['Start', { label: mockReactElement, path: '/deep' }];
            expect(normalizeBreadcrumb(fn)).toBe('Deep Nested');
        });

        it('should handle array with multiple levels of nesting', () => {
            const breadcrumb = [
                'Level1',
                [
                    'Level2-1',
                    {
                        label: () => ['Level3-1', 'Level3-2'],
                        path: '/multi-level',
                    },
                ],
            ];
            expect(normalizeBreadcrumb(breadcrumb)).toBe('Level3-2');
        });

        it('should handle Trans-like component structure', () => {
            // Simulating a <Trans>Global Settings</Trans> component
            const transElement = React.createElement(
                'Trans',
                {
                    i18nKey: 'global.settings',
                },
                'Global Settings',
            );
            const breadcrumb = [
                {
                    path: '/global-settings',
                    label: transElement,
                },
            ];
            expect(normalizeBreadcrumb(breadcrumb)).toBe('Global Settings');
        });
    });

    describe('edge cases', () => {
        it('should handle boolean values', () => {
            expect(normalizeBreadcrumb(true)).toBe('');
            expect(normalizeBreadcrumb(false)).toBe('');
        });

        it('should handle objects without label property', () => {
            const obj = { path: '/test', name: 'Test' };
            expect(normalizeBreadcrumb(obj)).toBe('');
        });

        it('should handle symbols', () => {
            const sym = Symbol('test');
            expect(normalizeBreadcrumb(sym)).toBe('');
        });

        it('should handle circular references gracefully', () => {
            const circular: any = { label: null };
            circular.label = circular;
            // This should not cause infinite recursion
            // The function should detect the circular reference and return empty string
            expect(() => normalizeBreadcrumb(circular)).not.toThrow();
            expect(normalizeBreadcrumb(circular)).toBe('');
        });

        it('should handle very deeply nested structures', () => {
            let deep: any = 'Final Value';
            for (let i = 0; i < 100; i++) {
                deep = { label: deep };
            }
            expect(normalizeBreadcrumb(deep)).toBe('Final Value');
        });
    });
});
