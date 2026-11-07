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

/**
 * 派单超时 / KDS 等待：同一行数据在 TZ=UTC 与 TZ=Asia/Shanghai 下判定必须一致。
 * 模拟 pg 读回：库里存 UTC 墙钟 03:33，进程按本地时区构造 Date（本地字段恒为 03:33）。
 */
describe('派单超时与 KDS 等待的读取口径', () => {
    const rowCreatedAt = new Date(2026, 10, 7, 3, 33, 0, 0);
    const trueCreatedMs = Date.UTC(2026, 10, 7, 3, 33, 0, 0);
    const elapsedMin = (nowMs: number) => (nowMs - dbNowWallToInstant(rowCreatedAt).getTime()) / 60_000;

    it('还原后的创建时刻与真实绝对时刻一致，与进程时区无关', () => {
        expect(dbNowWallToInstant(rowCreatedAt).getTime()).toBe(trueCreatedMs);
    });

    it('派单：缺锚单在真实第 1 分钟不触发任何阈值（5/10/15/30）', () => {
        const m = elapsedMin(trueCreatedMs + 60_000);
        expect(m).toBe(1);
        expect([5, 10, 15, 30].some(t => m > t)).toBe(false);
    });

    it('派单：各阈值在真实分钟数到点才触发', () => {
        expect(elapsedMin(trueCreatedMs + 6 * 60_000) > 5).toBe(true);
        expect(elapsedMin(trueCreatedMs + 11 * 60_000) > 10).toBe(true);
        expect(elapsedMin(trueCreatedMs + 16 * 60_000) > 15).toBe(true);
        expect(elapsedMin(trueCreatedMs + 31 * 60_000) > 30).toBe(true);
    });

    it('KDS：真实 16 分钟为 warn、26 分钟为 late，且不会一进页面就 late', () => {
        const KDS_WARN = 15;
        const KDS_LATE = 25;
        const urgency = (m: number) => (m >= KDS_LATE ? 'late' : m >= KDS_WARN ? 'warn' : 'normal');
        expect(urgency(elapsedMin(trueCreatedMs))).toBe('normal');
        expect(urgency(elapsedMin(trueCreatedMs + 16 * 60_000))).toBe('warn');
        expect(urgency(elapsedMin(trueCreatedMs + 26 * 60_000))).toBe('late');
    });
});
