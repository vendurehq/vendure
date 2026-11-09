import { type CopyLocale } from './i18n';
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
/** 14 态元数据；label 在访问时由 locales 解析，保证「定稿只改 locales」 */
export declare const STAGE_META: Record<CrossBorderStage, StageMeta>;
export interface TimelineStageCopy {
    titleZh: string;
    descZh: string;
}
/** 三条时间轴，顺序即 stageIndex（文案来自 i18n/zh.ts） */
export declare const TIMELINES: Record<BusinessLine, readonly TimelineStageCopy[]>;
/** 前台模块 → 运营业务线（CT-01 映射表）：logistics 为横切底座，无独立业务线 */
export declare function needTypeToBusinessLine(need: NeedType): BusinessLine | null;
export declare function stageMeta(stage: CrossBorderStage, locale?: CopyLocale): StageMeta;
export declare function isStageKnown(stage: string): stage is CrossBorderStage;
/** 该阶段是否适用于指定业务线；lines=null 表示横切底座 */
export declare function stageAppliesToLine(stage: CrossBorderStage, line: BusinessLine | null): boolean;
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
export declare function buildTimeline(line: BusinessLine, current: CrossBorderStage): TimelineNode[];
/** 当前阶段是否已落到该业务线时间轴的终点 */
export declare function isTerminalStage(stage: CrossBorderStage): boolean;
