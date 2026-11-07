import { describe, expect, it } from 'vitest';
import { dbNowWallToInstant } from './db-now-wall';

/**
 * 这些用例在 TZ=UTC 与 TZ=Asia/Shanghai 下必须给出完全相同的结果：
 * 入参只使用「本地字段」，输出只使用 Date.UTC，二者都不依赖进程时区。
 */
describe('dbNowWallToInstant', () => {
    it('把 UTC 墙钟原样还原成绝对时刻', () => {
        // 库里存 2026-11-07 02:50:55（UTC 墙钟），读回 Date 的本地字段即该墙钟
        const wall = new Date(2026, 10, 7, 2, 50, 55, 944);
        expect(dbNowWallToInstant(wall).toISOString()).toBe('2026-11-07T02:50:55.944Z');
    });

    it('跨日边界不做额外偏移', () => {
        const wall = new Date(2026, 10, 6, 23, 59, 59, 999);
        expect(dbNowWallToInstant(wall).toISOString()).toBe('2026-11-06T23:59:59.999Z');
    });

    it('与真实绝对时刻相差 8 小时的场景可被直接比对', () => {
        // 北京 11:33 的订单，createdAt 存 UTC 墙钟 03:33
        const createdAt = dbNowWallToInstant(new Date(2026, 10, 7, 3, 33, 0, 0));
        const placedAt = new Date('2026-11-07T03:33:00.000Z');
        expect(createdAt.getTime()).toBe(placedAt.getTime());
    });

    it('不依赖进程时区：只用本地字段做 Date.UTC 回环', () => {
        const wall = new Date(2026, 0, 1, 0, 0, 0, 0);
        expect(dbNowWallToInstant(wall).getTime()).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 0));
    });
});
