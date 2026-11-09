import { describe, expect, it } from 'vitest';

import { buildTimeline, needTypeToBusinessLine, STAGE_META, TIMELINES } from '../stages';
import { CROSS_BORDER_STAGES } from '../types';

describe('stage metadata', () => {
    it('covers all 14 contract stages exactly', () => {
        expect(Object.keys(STAGE_META).sort()).toEqual([...CROSS_BORDER_STAGES].sort());
        expect(Object.keys(STAGE_META)).toHaveLength(14);
    });

    it('maps stageIndex inside its business-line timeline bounds', () => {
        for (const stage of CROSS_BORDER_STAGES) {
            const meta = STAGE_META[stage];
            for (const line of meta.lines ?? (['net', 'pond', 'hook'] as const)) {
                expect(meta.stageIndex).toBeLessThan(TIMELINES[line].length);
            }
        }
    });

    it('keeps the documented timeline lengths', () => {
        expect(TIMELINES.net).toHaveLength(7);
        expect(TIMELINES.pond).toHaveLength(6);
        expect(TIMELINES.hook).toHaveLength(7);
    });
});

describe('needType → businessLine', () => {
    it('follows CT-01 mapping table', () => {
        expect(needTypeToBusinessLine('daily')).toBe('net');
        expect(needTypeToBusinessLine('collections')).toBe('pond');
        expect(needTypeToBusinessLine('projects')).toBe('hook');
        expect(needTypeToBusinessLine('logistics')).toBeNull();
    });
});

describe('buildTimeline', () => {
    it('marks earlier nodes done, current now, later todo', () => {
        const timeline = buildTimeline('pond', 'qc');
        expect(timeline.map(n => n.state)).toEqual(['done', 'done', 'done', 'done', 'now', 'todo']);
    });

    it('marks every node done once order completes', () => {
        const timeline = buildTimeline('net', 'done');
        expect(timeline.every(n => n.state === 'done' || n.state === 'now')).toBe(true);
        expect(timeline[timeline.length - 1].state).toBe('now');
    });

    it('keeps closed state on the first node', () => {
        const timeline = buildTimeline('pond', 'lost');
        expect(timeline[0].state).toBe('now');
        expect(timeline.slice(1).every(n => n.state === 'todo')).toBe(true);
    });
});
