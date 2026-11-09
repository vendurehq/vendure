"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const stages_1 = require("../stages");
const types_1 = require("../types");
(0, vitest_1.describe)('stage metadata', () => {
    (0, vitest_1.it)('covers all 14 contract stages exactly', () => {
        (0, vitest_1.expect)(Object.keys(stages_1.STAGE_META).sort()).toEqual([...types_1.CROSS_BORDER_STAGES].sort());
        (0, vitest_1.expect)(Object.keys(stages_1.STAGE_META)).toHaveLength(14);
    });
    (0, vitest_1.it)('maps stageIndex inside its business-line timeline bounds', () => {
        var _a;
        for (const stage of types_1.CROSS_BORDER_STAGES) {
            const meta = stages_1.STAGE_META[stage];
            for (const line of (_a = meta.lines) !== null && _a !== void 0 ? _a : ['net', 'pond', 'hook']) {
                (0, vitest_1.expect)(meta.stageIndex).toBeLessThan(stages_1.TIMELINES[line].length);
            }
        }
    });
    (0, vitest_1.it)('keeps the documented timeline lengths', () => {
        (0, vitest_1.expect)(stages_1.TIMELINES.net).toHaveLength(7);
        (0, vitest_1.expect)(stages_1.TIMELINES.pond).toHaveLength(6);
        (0, vitest_1.expect)(stages_1.TIMELINES.hook).toHaveLength(7);
    });
});
(0, vitest_1.describe)('needType → businessLine', () => {
    (0, vitest_1.it)('follows CT-01 mapping table', () => {
        (0, vitest_1.expect)((0, stages_1.needTypeToBusinessLine)('daily')).toBe('net');
        (0, vitest_1.expect)((0, stages_1.needTypeToBusinessLine)('collections')).toBe('pond');
        (0, vitest_1.expect)((0, stages_1.needTypeToBusinessLine)('projects')).toBe('hook');
        (0, vitest_1.expect)((0, stages_1.needTypeToBusinessLine)('logistics')).toBeNull();
    });
});
(0, vitest_1.describe)('buildTimeline', () => {
    (0, vitest_1.it)('marks earlier nodes done, current now, later todo', () => {
        const timeline = (0, stages_1.buildTimeline)('pond', 'qc');
        (0, vitest_1.expect)(timeline.map(n => n.state)).toEqual(['done', 'done', 'done', 'done', 'now', 'todo']);
    });
    (0, vitest_1.it)('marks every node done once order completes', () => {
        const timeline = (0, stages_1.buildTimeline)('net', 'done');
        (0, vitest_1.expect)(timeline.every(n => n.state === 'done' || n.state === 'now')).toBe(true);
        (0, vitest_1.expect)(timeline[timeline.length - 1].state).toBe('now');
    });
    (0, vitest_1.it)('keeps closed state on the first node', () => {
        const timeline = (0, stages_1.buildTimeline)('pond', 'lost');
        (0, vitest_1.expect)(timeline[0].state).toBe('now');
        (0, vitest_1.expect)(timeline.slice(1).every(n => n.state === 'todo')).toBe(true);
    });
});
//# sourceMappingURL=stages.spec.js.map