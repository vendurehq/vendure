import { describe, expect, it } from 'vitest';

import { platformDayKey, platformNowMs, platformWallToInstant, wallClockMs } from './platform-time';

/**
 * 归一为 timestamptz 后：时间列的读回值就是绝对时刻，墙上时间换算退化为恒等。
 * 断言只用 epoch 常量，不含任何本地时区解读，TZ=UTC 与 TZ=Asia/Shanghai 结果一致。
 */
describe('platform-time（归一后恒等语义）', () => {
    it('墙上时间换算已退化为恒等', () => {
        const instant = new Date('2026-11-30T00:00:00.000Z');
        expect(platformWallToInstant(instant).getTime()).toBe(instant.getTime());
        expect(wallClockMs(instant)).toBe(instant.getTime());
    });

    it('platformNowMs 返回绝对时刻', () => {
        const before = Date.now();
        const now = platformNowMs();
        expect(Math.abs(now - before)).toBeLessThan(1000);
        expect(Math.abs(now - Date.now())).toBeLessThan(1000);
    });

    it('平台自然日 key 在北京时间 0 点切日', () => {
        expect(platformDayKey(new Date('2026-11-30T15:59:59.999Z'))).toBe('2026-11-30');
        expect(platformDayKey(new Date('2026-11-30T16:00:00.000Z'))).toBe('2026-12-01');
    });
});
