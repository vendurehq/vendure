import type { BusinessLine, CrossBorderStage, CustomsStatus } from '../types';
import type { LocalePack } from './zh';
/**
 * 韩文文案。
 * 14 态与 6 个清关态取自 C 端 locales/ko.json 的现有示意译文；
 * 三条时间轴仅回填资源库中可直接对应的词条：
 * hook[0..5] 取 onebridge-web/gql/data/site.ts 的 process，
 * net[0/4/5/6]、pond[1/4] 取 C 端 ko.json / site.ts 的既有词组；
 * 其余标题与描述、物流 2 个节点仍留空，读取时按字段回落中文（见 index.ts）。
 * 定稿只改本文件，不动枚举与 stageIndex。
 */
export declare const ko: LocalePack;
export type { CrossBorderStage, CustomsStatus, BusinessLine };
