"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const i18n_1 = require("../i18n");
const payments_1 = require("../payments");
const stages_1 = require("../stages");
const types_1 = require("../types");
(0, vitest_1.describe)('ONE BRIDGE 文案 locales（定稿只改 locales）', () => {
    (0, vitest_1.it)('14 态中文文案全覆盖，且与冻结枚举一一对应', () => {
        (0, vitest_1.expect)(Object.keys(i18n_1.zh.stage).sort()).toEqual([...types_1.CROSS_BORDER_STAGES].sort());
        for (const stage of types_1.CROSS_BORDER_STAGES) {
            (0, vitest_1.expect)(i18n_1.zh.stage[stage].trim().length).toBeGreaterThan(0);
            (0, vitest_1.expect)(i18n_1.ko.stage[stage].trim().length).toBeGreaterThan(0);
        }
    });
    (0, vitest_1.it)('STAGE_META 的 label 来自 locales，stageIndex/badge 保持冻结', () => {
        for (const stage of types_1.CROSS_BORDER_STAGES) {
            (0, vitest_1.expect)(stages_1.STAGE_META[stage].labelZh).toBe(i18n_1.zh.stage[stage]);
            (0, vitest_1.expect)(stages_1.STAGE_META[stage].stageIndex).toBeGreaterThanOrEqual(0);
            (0, vitest_1.expect)(stages_1.STAGE_META[stage].stageIndex).toBeLessThanOrEqual(6);
        }
        // 抽查冻结契约关键值
        (0, vitest_1.expect)(stages_1.STAGE_META.lost.stageIndex).toBe(0);
        (0, vitest_1.expect)(stages_1.STAGE_META.wait_pay.stageIndex).toBe(1);
        (0, vitest_1.expect)(stages_1.STAGE_META.shipping.stageIndex).toBe(4);
        (0, vitest_1.expect)(stages_1.STAGE_META.done.stageIndex).toBe(6);
    });
    (0, vitest_1.it)('韩文缺失（清关 6 态 / 物流 5 节点）回落中文，不自造译文', () => {
        (0, vitest_1.expect)(Object.keys(i18n_1.zh.customsStatus).sort()).toEqual([...types_1.CUSTOMS_STATUSES].sort());
        for (const status of types_1.CUSTOMS_STATUSES) {
            (0, vitest_1.expect)((0, i18n_1.customsStatusLabel)(status, 'ko')).toBe(i18n_1.zh.customsStatus[status]);
        }
        (0, vitest_1.expect)((0, i18n_1.logisticsSteps)('zh')).toHaveLength(5);
        (0, vitest_1.expect)((0, i18n_1.logisticsSteps)('ko')).toEqual((0, i18n_1.logisticsSteps)('zh'));
    });
    (0, vitest_1.it)('14 态韩文占位在定稿后应替换，当前保留 C 端示意译文', () => {
        (0, vitest_1.expect)((0, i18n_1.stageLabel)('wait_pay', 'ko')).toBe('결제 대기');
        (0, vitest_1.expect)((0, i18n_1.stageLabel)('customs', 'ko')).toBe('통관 · 인도');
    });
    (0, vitest_1.it)('三条时间轴节点文案与 stageIndex 0..6 对齐', () => {
        (0, vitest_1.expect)(stages_1.TIMELINES.net).toHaveLength(7);
        (0, vitest_1.expect)(stages_1.TIMELINES.pond).toHaveLength(6);
        (0, vitest_1.expect)(stages_1.TIMELINES.hook).toHaveLength(7);
        for (const line of ['net', 'pond', 'hook']) {
            (0, vitest_1.expect)((0, i18n_1.timelineCopy)(line, 'zh')).toHaveLength(stages_1.TIMELINES[line].length);
            for (const node of (0, i18n_1.timelineCopy)(line, 'zh')) {
                (0, vitest_1.expect)(node.title.trim().length).toBeGreaterThan(0);
            }
        }
        (0, vitest_1.expect)((0, i18n_1.timelineNodeCopy)('net', 1, 'zh').title).toBe('支付完成');
    });
});
(0, vitest_1.describe)('韩国 PG 桩契约', () => {
    (0, vitest_1.it)('handler code 与回调路径固定', () => {
        (0, vitest_1.expect)(payments_1.KOREA_PG_HANDLER_CODE).toBe('korea-pg');
        (0, vitest_1.expect)(payments_1.KOREA_PG_CALLBACK_PATH).toBe('/onebridge/payments/korea-pg/callback');
    });
    (0, vitest_1.it)('paid 节点幂等键优先用显式值，否则按渠道+订单派生', () => {
        (0, vitest_1.expect)((0, payments_1.paidIdempotencyKey)('t1', 'PP-1')).toBe('payment:t1:PP-1:paid');
        (0, vitest_1.expect)((0, payments_1.paidIdempotencyKey)('t1', 'PP-1', 'evt-123')).toBe('evt-123');
        (0, vitest_1.expect)((0, payments_1.paidIdempotencyKey)('t1', 'PP-1', '   ')).toBe('payment:t1:PP-1:paid');
    });
});
//# sourceMappingURL=i18n.spec.js.map