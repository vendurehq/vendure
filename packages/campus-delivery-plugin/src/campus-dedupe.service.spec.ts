import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@vendure/core';
import { CampusDedupeService } from './campus-dedupe.service';

function memoryService(): CampusDedupeService {
    process.env.CAMPUS_DEDUPE_DRIVER = 'memory';
    return new CampusDedupeService({ rawConnection: { options: { type: 'sqlite' }, query: vi.fn() } } as any);
}

function dbService(query: any): CampusDedupeService {
    process.env.CAMPUS_DEDUPE_DRIVER = 'db';
    return new CampusDedupeService({ rawConnection: { options: { type: 'postgres' }, query } } as any);
}

afterEach(() => {
    delete process.env.CAMPUS_DEDUPE_DRIVER;
    delete process.env.CAMPUS_INSTANCE_COUNT;
    vi.restoreAllMocks();
});

describe('CampusDedupeService（memory）', () => {
    it('seen 只读；mark 后进入窗口；窗口过期自动失效', async () => {
        const svc = memoryService();
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        expect(await svc.seen('k', 60_000)).toBe(false);
        await svc.mark('k', 60_000);
        expect(await svc.seen('k', 60_000)).toBe(true);
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 61_000);
        expect(await svc.seen('k', 60_000)).toBe(false);
    });

    it('seenOrMark 首次抢占成功，再次调用命中窗口', async () => {
        const svc = memoryService();
        expect(await svc.seenOrMark('k', 60_000)).toBe(false);
        expect(await svc.seenOrMark('k', 60_000)).toBe(true);
    });

    it('incr 窗口内累加，过期重置为 1', async () => {
        const svc = memoryService();
        vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
        expect(await svc.incr('k', 60_000)).toBe(1);
        expect(await svc.incr('k', 60_000)).toBe(2);
        vi.spyOn(Date, 'now').mockReturnValue(2_000_000 + 61_000);
        expect(await svc.incr('k', 60_000)).toBe(1);
    });

    it('setJson/getJson/del 带 TTL', async () => {
        const svc = memoryService();
        vi.spyOn(Date, 'now').mockReturnValue(3_000_000);
        await svc.setJson('k', { a: 1 }, 60_000);
        expect(await svc.getJson('k')).toEqual({ a: 1 });
        vi.spyOn(Date, 'now').mockReturnValue(3_000_000 + 61_000);
        expect(await svc.getJson('k')).toBeNull();
        await svc.setJson('k2', { b: 2 }, 60_000);
        await svc.del('k2');
        expect(await svc.getJson('k2')).toBeNull();
    });
});

describe('CampusDedupeService（db）', () => {
    it('seenOrMark 抢占成功=false；冲突（无返回行）=true', async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce([[]]) // DELETE 过期行
            .mockResolvedValueOnce([[{ key: 'k' }]]) // INSERT RETURNING → 抢占成功
            .mockResolvedValueOnce([[]]) // DELETE
            .mockResolvedValueOnce([[]]); // INSERT 冲突 → 已存在
        const svc = dbService(query);
        expect(await svc.seenOrMark('k', 60_000)).toBe(false);
        expect(await svc.seenOrMark('k', 60_000)).toBe(true);
        const sql = String(query.mock.calls[1][0]);
        expect(sql).toContain('ON CONFLICT');
        expect(sql).toContain('RETURNING');
    });

    it('incr 读取 RETURNING counter', async () => {
        const query = vi.fn().mockResolvedValue([[{ counter: 3 }]]);
        const svc = dbService(query);
        expect(await svc.incr('k', 60_000)).toBe(3);
    });

    it('db 不可用 → 降级内存，语义仍生效（仅告警一次）', async () => {
        const query = vi.fn().mockRejectedValue(new Error('relation does not exist'));
        const svc = dbService(query);
        expect(await svc.seenOrMark('k', 60_000)).toBe(false);
        expect(await svc.seenOrMark('k', 60_000)).toBe(true);
    });

    it('setJson/getJson 读写 value（jsonb 对象已是对象）', async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[{ value: { a: 1 } }]])
            .mockResolvedValueOnce([[]]);
        const svc = dbService(query);
        await svc.setJson('k', { a: 1 }, 60_000);
        expect(await svc.getJson('k')).toEqual({ a: 1 });
    });

    it('10 年量级 TTL 能正常落库（bigint），不回退内存', async () => {
        const TEN_YEARS_MS = 3650 * 24 * 3600_000;
        const store = new Map<string, { value: unknown }>();
        // 模拟 pg：参数若仍按 int 传输，10 年毫秒会溢出（线上曾报 value "315360000000" is out of range for type integer）
        const query = vi.fn(async (sql: string, params: any[]) => {
            if (!String(sql).includes('::bigint') && params?.[1] > 2_147_483_647) {
                throw new Error(`value "${params[1]}" is out of range for type integer`);
            }
            if (String(sql).includes('INSERT INTO')) {
                store.set(params[0], { value: JSON.parse(params[2]) });
                return [[]];
            }
            if (String(sql).includes('SELECT "value"')) {
                return [[store.get(params[0])]];
            }
            return [[]];
        });
        const warn = vi.spyOn(Logger, 'warn').mockImplementation((() => undefined) as any);
        const svc = dbService(query);
        await svc.setJson('campus:refund_retry:installed_at', { at: '2026-11-08T00:00:00.000Z' }, TEN_YEARS_MS);
        expect(await svc.getJson('campus:refund_retry:installed_at')).toEqual({ at: '2026-11-08T00:00:00.000Z' });
        const insert = query.mock.calls.find(c => String(c[0]).includes('INSERT INTO'))!;
        expect(String(insert[0])).toContain('::bigint');
        expect(String(insert[0])).not.toContain('::int');
        expect(insert[1][1]).toBe(TEN_YEARS_MS);
        // 未触发「去重表不可用」降级告警 → 没有回退到内存实现
        expect(warn.mock.calls.some(c => String(c[0]).includes('去重表不可用'))).toBe(false);
    });
});
