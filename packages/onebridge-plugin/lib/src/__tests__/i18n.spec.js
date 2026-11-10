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
    (0, vitest_1.it)('清关 6 态使用 C 端既有韩文，不自造译文', () => {
        (0, vitest_1.expect)(Object.keys(i18n_1.zh.customsStatus).sort()).toEqual([...types_1.CUSTOMS_STATUSES].sort());
        const expected = {
            not_started: '통관 전',
            docs_preparing: '서류 준비 중',
            declared: '신고 완료',
            inspecting: '검사 중',
            cleared: '통관 완료',
            hold: '보류',
        };
        for (const status of types_1.CUSTOMS_STATUSES) {
            (0, vitest_1.expect)((0, i18n_1.customsStatusLabel)(status, 'ko')).toBe(expected[status]);
            (0, vitest_1.expect)((0, i18n_1.customsStatusLabel)(status, 'ko').trim().length).toBeGreaterThan(0);
        }
    });
    (0, vitest_1.it)('物流 5 节点：已有韩文直接使用，缺失项逐项回落中文', () => {
        (0, vitest_1.expect)((0, i18n_1.logisticsSteps)('zh')).toHaveLength(5);
        (0, vitest_1.expect)((0, i18n_1.logisticsSteps)('ko')).toEqual([
            '요청 접수',
            '확인 · 견적',
            i18n_1.zh.logistics.steps[2],
            i18n_1.zh.logistics.steps[3],
            '배송 · 사후',
        ]);
    });
    (0, vitest_1.it)('三条时间轴仅回填已有韩文，其余字段回落中文且无空串 / key 泄漏', () => {
        for (const line of ['net', 'pond', 'hook']) {
            (0, vitest_1.expect)(i18n_1.ko.timeline[line]).toHaveLength(i18n_1.zh.timeline[line].length);
            const koNodes = (0, i18n_1.timelineCopy)(line, 'ko');
            const zhNodes = (0, i18n_1.timelineCopy)(line, 'zh');
            (0, vitest_1.expect)(koNodes).toHaveLength(zhNodes.length);
            koNodes.forEach((node, index) => {
                (0, vitest_1.expect)(node.title.trim().length).toBeGreaterThan(0);
                (0, vitest_1.expect)(node.desc.trim().length).toBeGreaterThan(0);
                (0, vitest_1.expect)(node.title).not.toContain('undefined');
                (0, vitest_1.expect)(node.desc).not.toContain('undefined');
                const koCopy = i18n_1.ko.timeline[line][index];
                if (!(koCopy === null || koCopy === void 0 ? void 0 : koCopy.title))
                    (0, vitest_1.expect)(node.title).toBe(zhNodes[index].title);
                if (!(koCopy === null || koCopy === void 0 ? void 0 : koCopy.desc))
                    (0, vitest_1.expect)(node.desc).toBe(zhNodes[index].desc);
            });
        }
        (0, vitest_1.expect)((0, i18n_1.timelineNodeCopy)('hook', 0, 'ko').title).toBe('요청 · 사양 확정');
        (0, vitest_1.expect)((0, i18n_1.timelineNodeCopy)('hook', 6, 'ko').title).toBe(i18n_1.zh.timeline.hook[6].title);
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