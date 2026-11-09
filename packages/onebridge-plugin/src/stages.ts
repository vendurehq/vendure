import { stageLabel, timelineCopy, type CopyLocale } from './i18n';
import { StageEventState, NeedType, BusinessLine, CrossBorderStage } from './types';

/** 阶段徽标（demo/data.js STATUS.badge） */
export type StageBadge = 'warn' | 'info' | 'err' | 'ok' | 'mute';

export interface StageMeta {
    /** 中文文案，运行时来自 i18n/zh.ts（改文案不改这里） */
    labelZh: string;
    /** 韩文文案，运行时来自 i18n/ko.ts；缺失时回落中文 */
    labelKr: string;
    badge: StageBadge;
    /** demo/data.js STATUS.stage —— 时间轴索引，顺序即 stages 数组下标 */
    stageIndex: number;
    /** 适用业务线；null 表示横切底座，不绑定单一业务线 */
    lines: readonly BusinessLine[] | null;
}

/**
 * 14 态结构元数据（badge / stageIndex / lines 是冻结契约，逐字对齐 demo/data.js 与计划书 CT-01）。
 * 文案不写在这里：中文/韩文分别来自 i18n/zh.ts、i18n/ko.ts。
 */
const STAGE_STRUCTURE: Record<CrossBorderStage, { badge: StageBadge; stageIndex: number; lines: readonly BusinessLine[] | null }> = {
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
export const STAGE_META: Record<CrossBorderStage, StageMeta> = Object.fromEntries(
    Object.entries(STAGE_STRUCTURE).map(([stage, structure]) => [
        stage,
        {
            ...structure,
            labelZh: stageLabel(stage as CrossBorderStage, 'zh'),
            labelKr: stageLabel(stage as CrossBorderStage, 'ko'),
        },
    ]),
) as Record<CrossBorderStage, StageMeta>;

export interface TimelineStageCopy {
    titleZh: string;
    descZh: string;
}

/** 三条时间轴，顺序即 stageIndex（文案来自 i18n/zh.ts） */
export const TIMELINES: Record<BusinessLine, readonly TimelineStageCopy[]> = {
    net: timelineCopy('net', 'zh').map(toLegacyCopy),
    pond: timelineCopy('pond', 'zh').map(toLegacyCopy),
    hook: timelineCopy('hook', 'zh').map(toLegacyCopy),
};

function toLegacyCopy(copy: { title: string; desc: string }): TimelineStageCopy {
    return { titleZh: copy.title, descZh: copy.desc };
}

/** 前台模块 → 运营业务线（CT-01 映射表）：logistics 为横切底座，无独立业务线 */
export function needTypeToBusinessLine(need: NeedType): BusinessLine | null {
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

export function stageMeta(stage: CrossBorderStage, locale: CopyLocale = 'zh'): StageMeta {
    const meta = STAGE_META[stage];
    if (locale === 'zh') return meta;
    // 韩文按需解析（避免 import 时固化，便于后续热改 locales）
    return { ...meta, labelKr: stageLabel(stage, 'ko') };
}

export function isStageKnown(stage: string): stage is CrossBorderStage {
    return Object.prototype.hasOwnProperty.call(STAGE_META, stage);
}

/** 该阶段是否适用于指定业务线；lines=null 表示横切底座 */
export function stageAppliesToLine(stage: CrossBorderStage, line: BusinessLine | null): boolean {
    if (line === null) return true;
    const meta = STAGE_META[stage];
    return meta.lines === null || meta.lines.includes(line);
}

export interface TimelineNode {
    stage: CrossBorderStage | null;
    titleZh: string;
    descZh: string;
    state: StageEventState;
    stageIndex: number;
}

/**
 * 依据业务线与当前阶段生成时间轴，state 计算规则与 demo/data.js buildTimeline 一致：
 * i < cur → done，i === cur → now，i > cur → todo。
 */
export function buildTimeline(line: BusinessLine, current: CrossBorderStage): TimelineNode[] {
    const stages = TIMELINES[line];
    const cur = STAGE_META[current].stageIndex;
    return stages.map((copy, i) => ({
        stage: null,
        titleZh: copy.titleZh,
        descZh: copy.descZh,
        state: i < cur ? 'done' : i === cur ? 'now' : 'todo',
        stageIndex: i,
    }));
}

/** 当前阶段是否已落到该业务线时间轴的终点 */
export function isTerminalStage(stage: CrossBorderStage): boolean {
    return stage === 'done' || stage === 'lost';
}
