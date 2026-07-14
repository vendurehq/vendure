import { describe, expect, it } from 'vitest';

import { getStrategyName } from './strategy-name.helper';

describe('getStrategyName()', () => {
    it('returns .name property when available and length > 1', () => {
        const strategy = { name: 'MyStrategy' };
        expect(getStrategyName(strategy)).toBe('MyStrategy');
    });

    it('falls back to constructor.name when .name is not present', () => {
        class CustomStrategy {}
        const strategy = new CustomStrategy();
        expect(getStrategyName(strategy)).toBe('CustomStrategy');
    });

    it('returns "unknown" when .name is a single char (minified)', () => {
        const strategy = Object.create(null);
        strategy.name = 'a';
        expect(getStrategyName(strategy)).toBe('unknown');
    });

    it('returns "unknown" when constructor.name is a single char (minified)', () => {
        const strategy = Object.create(null);
        Object.defineProperty(strategy, 'constructor', {
            value: { name: 'x' },
        });
        expect(getStrategyName(strategy)).toBe('unknown');
    });

    it('returns "unknown" when both .name and constructor.name are missing', () => {
        const strategy = Object.create(null);
        expect(getStrategyName(strategy)).toBe('unknown');
    });

    it('prefers .name over constructor.name', () => {
        class FallbackStrategy {}
        const strategy = new FallbackStrategy();
        (strategy as any).name = 'PreferredName';
        expect(getStrategyName(strategy)).toBe('PreferredName');
    });

    it('returns "unknown" for empty string .name', () => {
        const strategy = Object.create(null);
        strategy.name = '';
        expect(getStrategyName(strategy)).toBe('unknown');
    });

    it('returns "unknown" when constructor is undefined', () => {
        const strategy = Object.create(null);
        strategy.constructor = undefined;
        expect(getStrategyName(strategy)).toBe('unknown');
    });

    describe('error and edge cases', () => {
        it('null input returns "unknown"', () => {
            expect(getStrategyName(null)).toBe('unknown');
        });

        it('undefined input returns "unknown"', () => {
            expect(getStrategyName(undefined)).toBe('unknown');
        });

        it('numeric .name is ignored, falls back to constructor.name', () => {
            const strategy = { name: 42, constructor: { name: 'FallbackName' } };
            expect(getStrategyName(strategy as any)).toBe('FallbackName');
        });

        it('two-character .name passes the length check', () => {
            const strategy = { name: 'ab' };
            expect(getStrategyName(strategy)).toBe('ab');
        });

        it('boolean .name is ignored, falls back to constructor.name', () => {
            const strategy = { name: true, constructor: { name: 'RealName' } };
            expect(getStrategyName(strategy as any)).toBe('RealName');
        });

        it('array .name is ignored, returns "unknown" with no constructor fallback', () => {
            const strategy = Object.create(null);
            strategy.name = ['not', 'a', 'string'];
            expect(getStrategyName(strategy)).toBe('unknown');
        });
    });
});
