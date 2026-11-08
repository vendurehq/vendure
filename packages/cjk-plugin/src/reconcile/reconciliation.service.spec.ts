import { describe, expect, it, vi } from 'vitest';
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
                hasShipment: false,
                pickupCollected: false,
                campusDelivered: false,
                paidSettled: 10000,
                settledRefunds: 0,
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

    it('D1 不再依赖 delivery_record：三证皆无时照常判 D1', async () => {
        const savedLines: any[] = [];
        const repo = {
            findOne: vi.fn().mockResolvedValue(null),
            save: vi.fn(async (e: any) => e),
            find: vi.fn().mockResolvedValue([]),
        };
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
                // 真实返回形态：对象数组（不是 [[row]]）
                rawConnection: {
                    query: vi.fn(async (sql: string) => (
                        sql.includes('pickup_redemption') ? [{ collected: false }] : [{ paid: 10000, refunded: 0 }]
                    )),
                },
            },
        });
        const batch = await svc.runBatch({ channel: { id: 'c1', code: 't1' } } as any, '2026-09-16', 'manual');
        expect(batch.d1Count).toBe(1);
        expect(savedLines.some(l => JSON.parse(l.diffTypes).includes('D1'))).toBe(true);
    });

    it('回归：rowsOf 按 TypeORM 真实返回（对象数组）解析，D3 实收足额不误报', async () => {
        // 该单已由校园配送实际送达（D1 不判），实收 10000 = 应收 10000，退款 0
        // 旧实现 rowsOf 取 out[0] 得到行对象，会把实收解析成 0 并误报 D3
        const repo = {
            findOne: vi.fn().mockResolvedValue(null),
            save: vi.fn(async (e: any) => e),
            find: vi.fn().mockResolvedValue([]),
        };
        const savedLines: any[] = [];
        const lineRepo = { find: vi.fn().mockResolvedValue([]), save: vi.fn(async (e: any) => { savedLines.push(e); return e; }) };
        const orderRepo = {
            find: vi.fn().mockResolvedValue([
                { id: 'o1', totalWithTax: 10000, state: 'Delivered', customFields: { deliveryStatus: 'delivered' }, fulfillments: [] },
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
                rawConnection: {
                    query: vi.fn(async (sql: string) => (
                        sql.includes('pickup_redemption') ? [{ collected: false }] : [{ paid: 10000, refunded: 0 }]
                    )),
                },
            },
        });
        const batch = await svc.runBatch({ channel: { id: 'c1', code: 't1' } } as any, '2026-09-17', 'manual');
        expect(batch.d3Count).toBe(0);
        expect(savedLines.some(l => JSON.parse(l.diffTypes).includes('D3'))).toBe(false);
    });
});
