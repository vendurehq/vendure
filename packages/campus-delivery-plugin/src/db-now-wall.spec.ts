import { describe, expect, it } from 'vitest';
import { dbNowWallToInstant, instantToDbNowWall } from './db-now-wall';

/**
 * 同一行数据在 TZ=UTC 与 TZ=Asia/Shanghai 下必须得到相同结果：
 * 两个函数分别只用「本地字段」和「UTC 字段」，不读取进程时区。
 */
describe('db-now-wall', () => {
    it('UTC 墙钟 → 绝对时刻', () => {
        const wall = new Date(2026, 10, 7, 3, 33, 0, 0);
        expect(dbNowWallToInstant(wall).toISOString()).toBe('2026-11-07T03:33:00.000Z');
    });

    it('绝对时刻 → UTC 墙钟（用于绑定 timestamp 列比较）', () => {
        const instant = new Date('2026-11-07T03:33:00.000Z');
        const wall = instantToDbNowWall(instant);
        expect(wall.getFullYear()).toBe(2026);
        expect(wall.getMonth()).toBe(10);
        expect(wall.getDate()).toBe(7);
        expect(wall.getHours()).toBe(3);
        expect(wall.getMinutes()).toBe(33);
    });

    it('两个函数互为逆运算', () => {
        const wall = new Date(2026, 10, 6, 23, 59, 59, 999);
        const instant = dbNowWallToInstant(wall);
        expect(instantToDbNowWall(instant).getTime()).toBe(wall.getTime());
    });

    it('售后申请时间与同刻下单时间对齐（真实旧订单 477 实测值）', () => {
        // 库里 createdAt 存 2026-11-07 02:50:55（UTC 墙钟），真实绝对时刻同为 02:50:55Z
        const stored = dbNowWallToInstant(new Date(2026, 10, 7, 2, 50, 55, 944));
        expect(stored.toISOString()).toBe('2026-11-07T02:50:55.944Z');
        // 未换算时会被当作北京 02:50，即早 8 小时——正是需要止血的偏差
        expect(Date.UTC(2026, 10, 7, 2, 50, 55, 944) - stored.getTime()).toBe(0);
    });
});
