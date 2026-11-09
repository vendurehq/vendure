import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@vendure/core';

import { findTenantNoOccupant, runSeedSteps } from './seed-steps';

describe('runSeedSteps', () => {
    it('单步失败不阻断后续步骤，并返回失败步骤名', async () => {
        const ran: string[] = [];
        const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined as any);

        const failed = await runSeedSteps({}, [
            { name: '第一步', run: async () => { ran.push('1'); } },
            { name: '第二步', run: async () => { throw new Error('仅超级管理员可创建全局档案'); } },
            { name: '第三步', run: async () => { ran.push('3'); } },
        ]);

        expect(ran).toEqual(['1', '3']);
        expect(failed).toEqual(['第二步']);
        // 失败步骤必须能在日志里看到步骤名与真实原因，不能被静默吞掉
        const messages = errorSpy.mock.calls.map(c => String(c[0]));
        expect(messages.some(m => m.includes('默认数据步骤失败 [第二步]') && m.includes('仅超级管理员可创建全局档案'))).toBe(true);
        expect(messages.some(m => m.includes('有 1 个步骤失败') && m.includes('第二步'))).toBe(true);

        errorSpy.mockRestore();
    });

    it('全部成功时返回空数组并打完成日志', async () => {
        const infoSpy = vi.spyOn(Logger, 'info').mockImplementation(() => undefined as any);
        const failed = await runSeedSteps({}, [
            { name: 'A', run: async () => undefined },
            { name: 'B', run: async () => undefined },
        ]);
        expect(failed).toEqual([]);
        expect(infoSpy.mock.calls.map(c => String(c[0]))).toContain('购物配送/支付默认数据初始化完成');
        infoSpy.mockRestore();
    });
});

describe('findTenantNoOccupant', () => {
    const ch = (code: string, tenantNo: number | null, isOfficial = false) => ({
        code,
        customFields: { tenantNo: tenantNo ?? undefined, isOfficial },
    });

    it('命中业务租户（t1 占 1）-> 报出占用者且 isOfficial=false', () => {
        expect(findTenantNoOccupant([ch('__default_channel__', null), ch('t1', 1)], 1)).toEqual({
            code: 't1',
            isOfficial: false,
        });
    });

    it('命中改名后的官方渠道 -> isOfficial=true（应 warn 跳过，不按业务冲突处理）', () => {
        expect(findTenantNoOccupant([ch('limin', 20, true)], 20)).toEqual({ code: 'limin', isOfficial: true });
    });

    it('号位空闲 -> undefined（可正常播种）', () => {
        expect(findTenantNoOccupant([ch('t1', 1)], 2)).toBeUndefined();
    });

    it('tenantNo 为 null/缺省不参与匹配', () => {
        expect(findTenantNoOccupant([ch('__default_channel__', null)], 0)).toBeUndefined();
    });
});
