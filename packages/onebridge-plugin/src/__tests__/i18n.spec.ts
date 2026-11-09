import { describe, expect, it } from 'vitest';

import { customsStatusLabel, ko, logisticsSteps, stageLabel, timelineCopy, timelineNodeCopy, zh } from '../i18n';
import { KOREA_PG_CALLBACK_PATH, KOREA_PG_HANDLER_CODE, paidIdempotencyKey } from '../payments';
import { STAGE_META, TIMELINES } from '../stages';
import { CROSS_BORDER_STAGES, CUSTOMS_STATUSES } from '../types';

describe('ONE BRIDGE 文案 locales（定稿只改 locales）', () => {
    it('14 态中文文案全覆盖，且与冻结枚举一一对应', () => {
        expect(Object.keys(zh.stage).sort()).toEqual([...CROSS_BORDER_STAGES].sort());
        for (const stage of CROSS_BORDER_STAGES) {
            expect(zh.stage[stage].trim().length).toBeGreaterThan(0);
            expect(ko.stage[stage].trim().length).toBeGreaterThan(0);
        }
    });

    it('STAGE_META 的 label 来自 locales，stageIndex/badge 保持冻结', () => {
        for (const stage of CROSS_BORDER_STAGES) {
            expect(STAGE_META[stage].labelZh).toBe(zh.stage[stage]);
            expect(STAGE_META[stage].stageIndex).toBeGreaterThanOrEqual(0);
            expect(STAGE_META[stage].stageIndex).toBeLessThanOrEqual(6);
        }
        // 抽查冻结契约关键值
        expect(STAGE_META.lost.stageIndex).toBe(0);
        expect(STAGE_META.wait_pay.stageIndex).toBe(1);
        expect(STAGE_META.shipping.stageIndex).toBe(4);
        expect(STAGE_META.done.stageIndex).toBe(6);
    });

    it('韩文缺失（清关 6 态 / 物流 5 节点）回落中文，不自造译文', () => {
        expect(Object.keys(zh.customsStatus).sort()).toEqual([...CUSTOMS_STATUSES].sort());
        for (const status of CUSTOMS_STATUSES) {
            expect(customsStatusLabel(status, 'ko')).toBe(zh.customsStatus[status]);
        }
        expect(logisticsSteps('zh')).toHaveLength(5);
        expect(logisticsSteps('ko')).toEqual(logisticsSteps('zh'));
    });

    it('14 态韩文占位在定稿后应替换，当前保留 C 端示意译文', () => {
        expect(stageLabel('wait_pay', 'ko')).toBe('결제 대기');
        expect(stageLabel('customs', 'ko')).toBe('통관 · 인도');
    });

    it('三条时间轴节点文案与 stageIndex 0..6 对齐', () => {
        expect(TIMELINES.net).toHaveLength(7);
        expect(TIMELINES.pond).toHaveLength(6);
        expect(TIMELINES.hook).toHaveLength(7);
        for (const line of ['net', 'pond', 'hook'] as const) {
            expect(timelineCopy(line, 'zh')).toHaveLength(TIMELINES[line].length);
            for (const node of timelineCopy(line, 'zh')) {
                expect(node.title.trim().length).toBeGreaterThan(0);
            }
        }
        expect(timelineNodeCopy('net', 1, 'zh').title).toBe('支付完成');
    });
});

describe('韩国 PG 桩契约', () => {
    it('handler code 与回调路径固定', () => {
        expect(KOREA_PG_HANDLER_CODE).toBe('korea-pg');
        expect(KOREA_PG_CALLBACK_PATH).toBe('/onebridge/payments/korea-pg/callback');
    });

    it('paid 节点幂等键优先用显式值，否则按渠道+订单派生', () => {
        expect(paidIdempotencyKey('t1', 'PP-1')).toBe('payment:t1:PP-1:paid');
        expect(paidIdempotencyKey('t1', 'PP-1', 'evt-123')).toBe('evt-123');
        expect(paidIdempotencyKey('t1', 'PP-1', '   ')).toBe('payment:t1:PP-1:paid');
    });
});
