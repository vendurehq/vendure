import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mergeTransitionDefinitions } from './merge-transition-definitions';
import { Transitions } from './types';

describe('FSM mergeTransitionDefinitions()', () => {
    it('handles no b', () => {
        const a: Transitions<'Start' | 'End'> = {
            Start: { to: ['End'] },
            End: { to: [] },
        };
        const result = mergeTransitionDefinitions(a);

        expect(result).toEqual(a);
    });

    it('adding new state, merge by default', () => {
        const a: Transitions<'Start' | 'End'> = {
            Start: { to: ['End'] },
            End: { to: [] },
        };
        const b: Transitions<'Start' | 'Cancelled'> = {
            Start: { to: ['Cancelled'] },
            Cancelled: { to: [] },
        };
        const result = mergeTransitionDefinitions(a, b);

        expect(result).toEqual({
            Start: { to: ['End', 'Cancelled'] },
            End: { to: [] },
            Cancelled: { to: [] },
        });
    });

    it('adding new state, replace', () => {
        const a: Transitions<'Start' | 'End'> = {
            Start: { to: ['End'] },
            End: { to: [] },
        };
        const b: Transitions<'Start' | 'Cancelled'> = {
            Start: { to: ['Cancelled'], mergeStrategy: 'replace' },
            Cancelled: { to: ['Start'] },
        };
        const result = mergeTransitionDefinitions(a, b);

        expect(result).toEqual({
            Start: { to: ['Cancelled'] },
            End: { to: [] },
            Cancelled: { to: ['Start'] },
        });
    });

    it('is an idempotent, pure function', () => {
        const a: Transitions<'Start' | 'End'> = {
            Start: { to: ['End'] },
            End: { to: [] },
        };
        const aCopy = { ...a };
        const b: Transitions<'Start' | 'Cancelled'> = {
            Start: { to: ['Cancelled'] },
            Cancelled: { to: ['Start'] },
        };
        let result = mergeTransitionDefinitions(a, b);
        result = mergeTransitionDefinitions(a, b);

        expect(a).toEqual(aCopy);
        expect(result).toEqual({
            Start: { to: ['End', 'Cancelled'] },
            End: { to: [] },
            Cancelled: { to: ['Start'] },
        });
    });
});
