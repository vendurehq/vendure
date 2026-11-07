import { describe, expect, it } from 'vitest';

import {
    instantToPlatformWall,
    platformDayKey,
    platformNowMs,
    platformWallToInstant,
    wallClockMs,
} from './platform-time';

/**
 * 关键不变量：同一绝对时刻在任意进程时区（TZ=UTC / TZ=Asia/Shanghai / 其他）
 * 下换算出的「平台墙上时间」必须完全一致。因此断言里只使用 Date.UTC 常量，
 * 不含任何本地时区解读。
 */
describe('platform-time', () => {
    it('绝对时刻 → 平台墙上时间：恒等于 UTC+8 墙钟', () => {
        const instant = new Date('2026-11-30T00:00:00.000Z');
        expect(wallClockMs(instantToPlatformWall(instant))).toBe(Date.UTC(2026, 10, 30, 8, 0, 0, 0));
    });

    it('平台墙上时间 → 绝对时刻：可逆', () => {
        const instant = new Date('2026-11-30T16:30:15.123Z');
        expect(platformWallToInstant(instantToPlatformWall(instant)).getTime()).toBe(instant.getTime());
    });

    it('platformNowMs 与进程时区无关', () => {
        const before = platformNowMs();
        const instant = new Date();
        expect(Math.abs(platformNowMs() - before)).toBeLessThan(1000);
        expect(wallClockMs(instantToPlatformWall(instant)).toString()).toHaveLength(13);
    });

    it('平台自然日 key 在北京时间 0 点切日', () => {
        expect(platformDayKey(new Date('2026-11-30T15:59:59.999Z'))).toBe('2026-11-30');
        expect(platformDayKey(new Date('2026-11-30T16:00:00.000Z'))).toBe('2026-12-01');
    });
});
