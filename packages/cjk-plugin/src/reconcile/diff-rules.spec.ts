import { describe, expect, it } from 'vitest';
import { DiffOrderInput, diffOrder } from './diff-rules';

const baseOrder: DiffOrderInput['order'] = {
    id: 'o1',
    totalWithTax: 10000,
    state: 'Delivered',
    customFields: {},
};

const full = (overrides: Partial<DiffOrderInput> = {}): DiffOrderInput => ({
    order: baseOrder,
    deliveryRecords: [{ mode: 'self', sourceLocationId: 'l1', status: 'Delivered' }],
    ledgerOuts: [{ sourceLocationId: 'l1', quantity: 1 }],
    paidSettled: 10000,
    settledRefunds: 0,
    hasShipment: false,
    pickupCollected: false,
    campusDelivered: true,
    mirrorDiff: 0,
    ...overrides,
});

describe('diffOrder', () => {
    it('全闭环无差异', () => {
        expect(diffOrder(full())).toEqual([]);
    });

    it('D1 已发货语义订单缺三种凭证', () => {
        expect(diffOrder(full({ deliveryRecords: [], campusDelivered: false }))).toContain('D1');
    });

    it('D1 凭证三者取其一即可：发货单 / 自提核销 / 校园配送实际送达', () => {
        expect(diffOrder(full({ deliveryRecords: [], campusDelivered: false, hasShipment: true }))).not.toContain('D1');
        expect(diffOrder(full({ deliveryRecords: [], campusDelivered: false, pickupCollected: true }))).not.toContain('D1');
        expect(diffOrder(full({ deliveryRecords: [], campusDelivered: true }))).not.toContain('D1');
    });

    it('D1 不再依赖 delivery_record：该表为空也照常判定', () => {
        // deliveryRecords 为空只影响 D2 取仓，不再作为 D1 凭证，也不触发整轮跳过
        expect(diffOrder(full({ deliveryRecords: [], campusDelivered: false })).filter(d => d === 'D1')).toEqual(['D1']);
    });

    it('D1 只判已发货语义状态：Pending/AddingItems 不判', () => {
        expect(diffOrder(full({ order: { ...baseOrder, state: 'Pending' }, deliveryRecords: [], ledgerOuts: [] })).filter(d => d === 'D1')).toEqual([]);
        expect(diffOrder(full({ order: { ...baseOrder, state: 'AddingItems' }, deliveryRecords: [] })).filter(d => d === 'D1')).toEqual([]);
    });

    it('D2 扣仓不一致', () => {
        expect(diffOrder(full({ deliveryRecords: [{ mode: 'self', sourceLocationId: 'l2', status: 'Delivered' }] }))).toContain('D2');
    });

    it('D3 实收口径：已结算支付 − 已结算退款', () => {
        // 实收足额
        expect(diffOrder(full({ paidSettled: 10000, settledRefunds: 0 }))).not.toContain('D3');
        // 退过款：实收 10000 − 已退 3000 = 7000 ≠ 应付 10000 → 差异
        expect(diffOrder(full({ paidSettled: 10000, settledRefunds: 3000 }))).toContain('D3');
        // 少收
        expect(diffOrder(full({ paidSettled: 8000 }))).toContain('D3');
    });

    it('D3 不判未实收状态（PaymentAuthorized / PaymentPending）', () => {
        expect(diffOrder(full({ order: { ...baseOrder, state: 'PaymentAuthorized' }, paidSettled: 0, ledgerOuts: [], deliveryRecords: [] }))).not.toContain('D3');
        expect(diffOrder(full({ order: { ...baseOrder, state: 'PaymentPending' }, paidSettled: 0 }))).not.toContain('D3');
    });

    it('D4 镜像不平', () => {
        expect(diffOrder(full({ mirrorDiff: 5 }))).toContain('D4');
    });

    it('取消单不产 D1/D3（无配送记录、无实收属正常）', () => {
        expect(diffOrder(full({ order: { ...baseOrder, state: 'Cancelled' }, deliveryRecords: [], ledgerOuts: [], paidSettled: 0 })))
            .toEqual([]);
    });

    it('取消单仍可检出 D4 镜像不平', () => {
        expect(diffOrder(full({ order: { ...baseOrder, state: 'Cancelled' }, deliveryRecords: [], ledgerOuts: [], mirrorDiff: 3 })))
            .toEqual(['D4']);
    });

    it('草稿单（AddingItems）不产任何差异', () => {
        expect(diffOrder(full({ order: { ...baseOrder, state: 'AddingItems' }, deliveryRecords: [], mirrorDiff: 5 }))).toEqual([]);
    });

    it('已结算订单（PaymentSettled）只判 D3，不判 D1（D1 仅限已发货语义）', () => {
        const diffs = diffOrder(full({ order: { ...baseOrder, state: 'PaymentSettled' }, deliveryRecords: [], paidSettled: 8000 }));
        expect(diffs).toContain('D3');
        expect(diffs).not.toContain('D1');
    });

    it('已交付订单仍能检出 D2/D3 真实差异（豁免不越界）', () => {
        const diffs = diffOrder(full({ deliveryRecords: [{ mode: 'self', sourceLocationId: 'l2', status: 'Delivered' }], paidSettled: 9000 }));
        expect(diffs).toContain('D2');
        expect(diffs).toContain('D3');
        expect(diffs).not.toContain('D1');
    });
});
