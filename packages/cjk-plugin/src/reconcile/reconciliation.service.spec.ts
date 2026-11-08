import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@vendure/core';
import { ReconciliationService } from './reconciliation.service';

describe('ReconciliationService', () => {
    function makeService(overrides: Record<string, any> = {}) {
        const svc: any = new ReconciliationService({} as any);
        Object.assign(svc, {
            connection: {
                getRepository: vi.fn(),
                getEntityOrThrow: vi.fn(),
            },
            collectOrderData: vi.fn(async () => ({
                deliveryRecords: [],
                ledgerOuts: [{ sourceLocationId: 'l1', quantity: 1 }],
                settlements: [{ status: 'PAID', amount: 10000 }],
                mirrorDiff: 0,
            })),
            ...overrides,
        });
        return svc;
    }

    it('同日重复跑批幂等：已存在 done 批次则跳过', async () => {
        const repo = { findOne: vi.fn().mockResolvedValue({ id: 'b1', status: 'done' }) };
        const svc = makeService({
            connection: { getRepository: vi.fn().mockReturnValue(repo), getEntityOrThrow: vi.fn() },
        });
        const result = await svc.runBatch({ channel: { id: 'c1' } } as any, '2026-09-14', 'manual');
        expect(result).toBeNull();
    });

    it('跑批：差异行落库并计数', async () => {
        const savedBatch: any[] = [];
        const savedLines: any[] = [];
        const repo = {
            findOne: vi.fn().mockResolvedValue(null),
            save: vi.fn(async (e: any) => { savedBatch.push(e); return e; }),
        };
        const lineRepo = {
            find: vi.fn().mockResolvedValue([]),
            save: vi.fn(async (e: any) => { savedLines.push(e); return e; }),
        };
        const orderRepo = {
            find: vi.fn().mockResolvedValue([
                { id: 'o1', totalWithTax: 10000, state: 'Delivered', customFields: {} },
            ]),
        };
        const svc = makeService({
            connection: {
                getRepository: vi.fn((_ctx: any, name: any) => {
                    const n = typeof name === 'string' ? name : name?.name;
                    if (n === 'ReconciliationBatch') return repo;
                    if (n === 'ReconciliationOrderLine') return lineRepo;
                    if (n === 'Order') return orderRepo;
                    return repo;
                }),
                getEntityOrThrow: vi.fn(),
            },
        });
        const batch = await svc.runBatch({ channel: { id: 'c1', code: 't1' } } as any, '2026-09-14', 'manual');
        expect(batch.d1Count).toBe(1);
        expect(savedLines.length).toBe(1);
    });

    it('取单显式 ORDER BY id，避免超过 500 条时静默截断成任意子集', async () => {
        const repo = { findOne: vi.fn().mockResolvedValue(null), save: vi.fn(async (e: any) => e) };
        const orderRepo = { find: vi.fn().mockResolvedValue([]) };
        const svc = makeService({
            connection: {
                getRepository: vi.fn((_ctx: any, name: any) => {
                    const n = typeof name === 'string' ? name : name?.name;
                    if (n === 'Order') return orderRepo;
                    return repo;
                }),
                getEntityOrThrow: vi.fn(),
            },
        });
        // 已存在 done 批次会提前返回，这里直接驱动到取单前的分支：用不同日期绕过幂等
        await svc.runBatch({ channel: { id: 'c1', code: 't1' } } as any, '2026-09-15', 'manual');
        expect(orderRepo.find).toHaveBeenCalledWith(expect.objectContaining({ order: { id: 'ASC' }, take: 500 }));
    });

    it('D1 数据源缺失：delivery_record 全表 0 时不判 D1，也不落差异行', async () => {
        vi.spyOn(Logger, 'warn').mockImplementation((() => undefined) as any);
        const savedLines: any[] = [];
        const repo = { findOne: vi.fn().mockResolvedValue(null), save: vi.fn(async (e: any) => e) };
        const lineRepo = { find: vi.fn().mockResolvedValue([]), save: vi.fn(async (e: any) => { savedLines.push(e); return e; }) };
        const orderRepo = {
            find: vi.fn().mockResolvedValue([
                { id: 'o1', totalWithTax: 10000, state: 'Delivered', customFields: {}, fulfillments: [] },
            ]),
        };
        const svc = makeService({
            connection: {
                getRepository: vi.fn((_ctx: any, name: any) => {
                    const n = typeof name === 'string' ? name : name?.name;
                    if (n === 'ReconciliationBatch') return repo;
                    if (n === 'ReconciliationOrderLine') return lineRepo;
                    if (n === 'Order') return orderRepo;
                    return repo;
                }),
                getEntityOrThrow: vi.fn(),
                rawConnection: { query: vi.fn().mockResolvedValue([[{ total: 0, recent: 0 }]]) },
            },
        });
        const batch = await svc.runBatch({ channel: { id: 'c1', code: 't1' } } as any, '2026-09-16', 'manual');
        expect(batch.d1Count).toBe(0);
        expect(savedLines.some(l => JSON.parse(l.diffTypes).includes('D1'))).toBe(false);
    });
});
