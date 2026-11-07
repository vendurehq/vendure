import { describe, expect, it } from 'vitest';
import { DiffOrderInput, diffOrder } from './diff-rules';

const baseOrder: DiffOrderInput['order'] = {
    id: 'o1',
    totalWithTax: 10000,
    state: 'Delivered',
    customFields: {},
};

describe('diffOrder', () => {
    it('全闭环无差异', () => {
        const input: DiffOrderInput = {
            order: baseOrder,
            deliveryRecords: [{ mode: 'self', sourceLocationId: 'l1', status: 'Delivered' }],
            ledgerOuts: [{ sourceLocationId: 'l1', quantity: 1 }],
            settlements: [{ status: 'PAID', amount: 10000 }],
            mirrorDiff: 0,
        };
        expect(diffOrder(input)).toEqual([]);
    });

    it('D1 缺配送记录', () => {
        const input: DiffOrderInput = {
            order: baseOrder,
            deliveryRecords: [],
            ledgerOuts: [{ sourceLocationId: 'l1', quantity: 1 }],
            settlements: [{ status: 'PAID', amount: 10000 }],
            mirrorDiff: 0,
        };
        expect(diffOrder(input)).toContain('D1');
    });

    it('D2 扣仓不一致', () => {
        const input: DiffOrderInput = {
            order: baseOrder,
            deliveryRecords: [{ mode: 'self', sourceLocationId: 'l2', status: 'Delivered' }],
            ledgerOuts: [{ sourceLocationId: 'l1', quantity: 1 }],
            settlements: [{ status: 'PAID', amount: 10000 }],
            mirrorDiff: 0,
        };
        expect(diffOrder(input)).toContain('D2');
    });

    it('D3 金额不平（含 COD 未签收不算差）', () => {
        const paid: DiffOrderInput = {
            order: baseOrder,
            deliveryRecords: [{ mode: 'self', sourceLocationId: 'l1', status: 'Delivered' }],
            ledgerOuts: [{ sourceLocationId: 'l1', quantity: 1 }],
            settlements: [{ status: 'PENDING_SIGN', amount: 10000 }],
            mirrorDiff: 0,
        };
        expect(diffOrder(paid)).not.toContain('D3'); // COD 未签收不算差

        const short: DiffOrderInput = {
            order: baseOrder,
            deliveryRecords: [{ mode: 'self', sourceLocationId: 'l1', status: 'Delivered' }],
            ledgerOuts: [{ sourceLocationId: 'l1', quantity: 1 }],
            settlements: [{ status: 'PAID', amount: 8000 }],
            mirrorDiff: 0,
        };
        expect(diffOrder(short)).toContain('D3');
    });

    it('D4 镜像不平', () => {
        const input: DiffOrderInput = {
            order: baseOrder,
            deliveryRecords: [{ mode: 'self', sourceLocationId: 'l1', status: 'Delivered' }],
            ledgerOuts: [{ sourceLocationId: 'l1', quantity: 1 }],
            settlements: [{ status: 'PAID', amount: 10000 }],
            mirrorDiff: 5,
        };
        expect(diffOrder(input)).toContain('D4');
    });

    it('退款单不参与 D3', () => {
        const input: DiffOrderInput = {
            order: { ...baseOrder, state: 'Cancelled' },
            deliveryRecords: [],
            ledgerOuts: [],
            settlements: [],
            mirrorDiff: 0,
            cancelled: true,
        };
        expect(diffOrder(input)).not.toContain('D3');
    });

    it('取消单不产 D1/D3（无配送记录、无实收属正常）', () => {
        const input: DiffOrderInput = {
            order: { ...baseOrder, state: 'Cancelled' },
            deliveryRecords: [],
            ledgerOuts: [],
            settlements: [],
            mirrorDiff: 0,
        };
        expect(diffOrder(input)).toEqual([]);
    });

    it('取消单仍可检出 D4 镜像不平', () => {
        const input: DiffOrderInput = {
            order: { ...baseOrder, state: 'Cancelled' },
            deliveryRecords: [],
            ledgerOuts: [],
            settlements: [],
            mirrorDiff: 3,
        };
        expect(diffOrder(input)).toEqual(['D4']);
    });

    it('草稿单（AddingItems）不产任何差异', () => {
        const input: DiffOrderInput = {
            order: { ...baseOrder, state: 'AddingItems' },
            deliveryRecords: [],
            ledgerOuts: [{ sourceLocationId: 'l1', quantity: 1 }],
            settlements: [],
            mirrorDiff: 5,
        };
        expect(diffOrder(input)).toEqual([]);
    });

    it('已结算订单仍能检出 D1/D3 真实差异（豁免不越界）', () => {
        const input: DiffOrderInput = {
            order: { ...baseOrder, state: 'PaymentSettled' },
            deliveryRecords: [],
            ledgerOuts: [{ sourceLocationId: 'l1', quantity: 1 }],
            settlements: [{ status: 'PAID', amount: 8000 }],
            mirrorDiff: 0,
        };
        const diffs = diffOrder(input);
        expect(diffs).toContain('D1');
        expect(diffs).toContain('D3');
    });

    it('已交付订单仍能检出 D2/D3 真实差异（豁免不越界）', () => {
        const input: DiffOrderInput = {
            order: { ...baseOrder, state: 'Delivered' },
            deliveryRecords: [{ mode: 'self', sourceLocationId: 'l2', status: 'Delivered' }],
            ledgerOuts: [{ sourceLocationId: 'l1', quantity: 1 }],
            settlements: [{ status: 'PAID', amount: 9000 }],
            mirrorDiff: 0,
        };
        const diffs = diffOrder(input);
        expect(diffs).toContain('D2');
        expect(diffs).toContain('D3');
        expect(diffs).not.toContain('D1');
    });
});
