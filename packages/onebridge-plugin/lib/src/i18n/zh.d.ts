import type { BusinessLine, CrossBorderStage, CustomsStatus } from '../types';
export interface TimelineCopy {
    title: string;
    desc: string;
}
/** 一个语言包的结构。定稿只改 zh.ts / ko.ts，不改 CROSS_BORDER_STAGES / stageIndex / 枚举。 */
export interface LocalePack {
    stage: Record<CrossBorderStage, string>;
    customsStatus: Record<CustomsStatus, string>;
    timeline: Record<BusinessLine, TimelineCopy[]>;
    logistics: {
        steps: string[];
    };
}
/**
 * 中文文案（权威释义）：14 态取自 demo/data.js STATUS，
 * 三条时间轴取自 demo/data.js STAGES + buildTimeline 的 desc，
 * 物流 5 节点取 options/data.js logistics.steps。
 */
export declare const zh: LocalePack;
