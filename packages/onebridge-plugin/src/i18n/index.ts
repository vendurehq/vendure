import type { BusinessLine, CrossBorderStage, CustomsStatus } from '../types';
import { ko } from './ko';
import { zh, type LocalePack, type TimelineCopy } from './zh';

export type { LocalePack, TimelineCopy };
export { ko, zh };

/** ONE BRIDGE 站点的两种文案语言（与 C 端 locales 对齐） */
export type CopyLocale = 'ko' | 'zh';

function pick(candidate: string | undefined, fallback: string): string {
    return candidate && candidate.trim() ? candidate : fallback;
}

/** 阶段标签：韩文缺失时回落中文，禁止在代码里自造韩文 */
export function stageLabel(stage: CrossBorderStage, locale: CopyLocale = 'zh'): string {
    return locale === 'ko' ? pick(ko.stage[stage], zh.stage[stage]) : zh.stage[stage];
}

/** 清关子状态标签（CT-06 六态） */
export function customsStatusLabel(status: CustomsStatus, locale: CopyLocale = 'zh'): string {
    return locale === 'ko' ? pick(ko.customsStatus[status], zh.customsStatus[status]) : zh.customsStatus[status];
}

/** 时间轴节点文案（按业务线），韩文缺失逐字段回落中文 */
export function timelineCopy(line: BusinessLine, locale: CopyLocale = 'zh'): TimelineCopy[] {
    return zh.timeline[line].map((fallback, index) => {
        const koCopy = ko.timeline[line][index];
        if (locale !== 'ko' || !koCopy) return { ...fallback };
        return {
            title: pick(koCopy.title, fallback.title),
            desc: pick(koCopy.desc, fallback.desc),
        };
    });
}

/** 物流 5 节点文案（options/data.js logistics.steps） */
export function logisticsSteps(locale: CopyLocale = 'zh'): string[] {
    return zh.logistics.steps.map((fallback, index) => {
        const koStep = ko.logistics.steps[index];
        return locale === 'ko' ? pick(koStep, fallback) : fallback;
    });
}

/** 某条时间轴上第 index 个节点的文案（支付完成节点即 net[1]） */
export function timelineNodeCopy(line: BusinessLine, index: number, locale: CopyLocale = 'zh'): TimelineCopy {
    const nodes = timelineCopy(line, locale);
    return nodes[index] ?? { title: '', desc: '' };
}

export function localePack(locale: CopyLocale): LocalePack {
    return locale === 'ko' ? ko : zh;
}
