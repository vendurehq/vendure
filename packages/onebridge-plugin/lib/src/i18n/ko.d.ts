import type { BusinessLine, CrossBorderStage, CustomsStatus } from '../types';
import type { LocalePack } from './zh';
/**
 * 韩文文案（占位）。
 * TODO(韩文待定稿)：14 态为 C 端 locales/ko.json 的现有示意译文，仅作占位；
 * 6 个清关态、三条时间轴、物流 5 节点尚无正式韩文，一律留空字符串，
 * 读取时回落中文（见 index.ts）。定稿只改本文件，不动枚举与 stageIndex。
 */
export declare const ko: LocalePack;
export type { CrossBorderStage, CustomsStatus, BusinessLine };
