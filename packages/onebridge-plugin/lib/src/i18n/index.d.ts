import type { BusinessLine, CrossBorderStage, CustomsStatus } from '../types';
import { ko } from './ko';
import { zh, type LocalePack, type TimelineCopy } from './zh';
export type { LocalePack, TimelineCopy };
export { ko, zh };
/** ONE BRIDGE 站点的两种文案语言（与 C 端 locales 对齐） */
export type CopyLocale = 'ko' | 'zh';
/** 阶段标签：韩文缺失时回落中文，禁止在代码里自造韩文 */
export declare function stageLabel(stage: CrossBorderStage, locale?: CopyLocale): string;
/** 清关子状态标签（CT-06 六态） */
export declare function customsStatusLabel(status: CustomsStatus, locale?: CopyLocale): string;
/** 时间轴节点文案（按业务线），韩文缺失逐字段回落中文 */
export declare function timelineCopy(line: BusinessLine, locale?: CopyLocale): TimelineCopy[];
/** 物流 5 节点文案（options/data.js logistics.steps） */
export declare function logisticsSteps(locale?: CopyLocale): string[];
/** 某条时间轴上第 index 个节点的文案（支付完成节点即 net[1]） */
export declare function timelineNodeCopy(line: BusinessLine, index: number, locale?: CopyLocale): TimelineCopy;
export declare function localePack(locale: CopyLocale): LocalePack;
