/**
 * 平台时区 = Asia/Shanghai（UTC+8，无夏令时）。
 *
 * 2026-11 第二批归一后，本插件的时间列已统一为 `timestamptz`，pg 驱动读写都是绝对时刻，
 * 不再存在「墙上时间 ↔ 绝对时刻」的换算需求。为兼容既有调用方，下列函数保留原名，
 * 语义退化为恒等 / 直接取 epoch；`platformDayKey` 仍按 Asia/Shanghai 切日。
 */

export const PLATFORM_TIME_ZONE = 'Asia/Shanghai';
export const PLATFORM_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 列已是 timestamptz：平台墙上时间即绝对时刻，恒等返回。 */
export function platformWallToInstant(wall: Date): Date {
    return wall;
}

/** 绝对时刻的 epoch 毫秒（不再取本地字段拼墙上时间）。 */
export function wallClockMs(d: Date): number {
    return d.getTime();
}

/** 当前绝对时刻（毫秒）。 */
export function platformNowMs(): number {
    return Date.now();
}

/** 平台时区自然日 key：YYYY-MM-DD（日切 / 每日限额口径）。 */
export function platformDayKey(instant: Date): string {
    const d = new Date(instant.getTime() + PLATFORM_TZ_OFFSET_MS);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
