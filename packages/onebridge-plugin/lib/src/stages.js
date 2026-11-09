"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIMELINES = exports.STAGE_META = void 0;
exports.needTypeToBusinessLine = needTypeToBusinessLine;
exports.stageMeta = stageMeta;
exports.isStageKnown = isStageKnown;
exports.stageAppliesToLine = stageAppliesToLine;
exports.buildTimeline = buildTimeline;
exports.isTerminalStage = isTerminalStage;
const i18n_1 = require("./i18n");
/**
 * 14 态结构元数据（badge / stageIndex / lines 是冻结契约，逐字对齐 demo/data.js 与计划书 CT-01）。
 * 文案不写在这里：中文/韩文分别来自 i18n/zh.ts、i18n/ko.ts。
 */
const STAGE_STRUCTURE = {
    lost: { badge: 'mute', stageIndex: 0, lines: ['pond'] },
    wait_pay: { badge: 'warn', stageIndex: 1, lines: ['net'] },
    quoting: { badge: 'warn', stageIndex: 1, lines: ['pond'] },
    requirement: { badge: 'warn', stageIndex: 1, lines: ['hook'] },
    sourcing: { badge: 'info', stageIndex: 2, lines: ['hook'] },
    risk: { badge: 'err', stageIndex: 2, lines: ['hook'] },
    sample: { badge: 'info', stageIndex: 3, lines: ['pond'] },
    producing: { badge: 'info', stageIndex: 3, lines: ['hook'] },
    shipping: { badge: 'info', stageIndex: 4, lines: ['net'] },
    qc: { badge: 'info', stageIndex: 4, lines: ['pond'] },
    refund: { badge: 'err', stageIndex: 5, lines: ['net'] },
    delivered: { badge: 'ok', stageIndex: 5, lines: ['pond', 'hook'] },
    customs: { badge: 'info', stageIndex: 5, lines: ['hook'] },
    done: { badge: 'ok', stageIndex: 6, lines: ['net'] },
};
/** 14 态元数据；label 在访问时由 locales 解析，保证「定稿只改 locales」 */
exports.STAGE_META = Object.fromEntries(Object.entries(STAGE_STRUCTURE).map(([stage, structure]) => [
    stage,
    Object.assign(Object.assign({}, structure), { labelZh: (0, i18n_1.stageLabel)(stage, 'zh'), labelKr: (0, i18n_1.stageLabel)(stage, 'ko') }),
]));
/** 三条时间轴，顺序即 stageIndex（文案来自 i18n/zh.ts） */
exports.TIMELINES = {
    net: (0, i18n_1.timelineCopy)('net', 'zh').map(toLegacyCopy),
    pond: (0, i18n_1.timelineCopy)('pond', 'zh').map(toLegacyCopy),
    hook: (0, i18n_1.timelineCopy)('hook', 'zh').map(toLegacyCopy),
};
function toLegacyCopy(copy) {
    return { titleZh: copy.title, descZh: copy.desc };
}
/** 前台模块 → 运营业务线（CT-01 映射表）：logistics 为横切底座，无独立业务线 */
function needTypeToBusinessLine(need) {
    switch (need) {
        case 'daily':
            return 'net';
        case 'collections':
            return 'pond';
        case 'projects':
            return 'hook';
        case 'logistics':
            return null;
    }
}
function stageMeta(stage, locale = 'zh') {
    const meta = exports.STAGE_META[stage];
    if (locale === 'zh')
        return meta;
    // 韩文按需解析（避免 import 时固化，便于后续热改 locales）
    return Object.assign(Object.assign({}, meta), { labelKr: (0, i18n_1.stageLabel)(stage, 'ko') });
}
function isStageKnown(stage) {
    return Object.prototype.hasOwnProperty.call(exports.STAGE_META, stage);
}
/** 该阶段是否适用于指定业务线；lines=null 表示横切底座 */
function stageAppliesToLine(stage, line) {
    if (line === null)
        return true;
    const meta = exports.STAGE_META[stage];
    return meta.lines === null || meta.lines.includes(line);
}
/**
 * 依据业务线与当前阶段生成时间轴，state 计算规则与 demo/data.js buildTimeline 一致：
 * i < cur → done，i === cur → now，i > cur → todo。
 */
function buildTimeline(line, current) {
    const stages = exports.TIMELINES[line];
    const cur = exports.STAGE_META[current].stageIndex;
    return stages.map((copy, i) => ({
        stage: null,
        titleZh: copy.titleZh,
        descZh: copy.descZh,
        state: i < cur ? 'done' : i === cur ? 'now' : 'todo',
        stageIndex: i,
    }));
}
/** 当前阶段是否已落到该业务线时间轴的终点 */
function isTerminalStage(stage) {
    return stage === 'done' || stage === 'lost';
}
//# sourceMappingURL=stages.js.map