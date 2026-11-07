/**
 * 平台时区 = Asia/Shanghai（UTC+8，无夏令时）。
 *
 * 2026-11 第二批归一后，本插件的时间列已统一为 `timestamptz`，pg 驱动读写都是绝对时刻，
 * 不再存在「墙上时间 ↔ 绝对时刻」的换算需求。为兼容既有调用方，下列函数保留原名，
 * 语义退化为恒等 / 直接取 epoch；`platformDayKey` 仍按 Asia/Shanghai 切日。
 */
export declare const PLATFORM_TIME_ZONE = "Asia/Shanghai";
export declare const PLATFORM_TZ_OFFSET_MS: number;
/** 列已是 timestamptz：平台墙上时间即绝对时刻，恒等返回。 */
export declare function platformWallToInstant(wall: Date): Date;
/** 绝对时刻的 epoch 毫秒（不再取本地字段拼墙上时间）。 */
export declare function wallClockMs(d: Date): number;
/** 当前绝对时刻（毫秒）。 */
export declare function platformNowMs(): number;
/** 平台时区自然日 key：YYYY-MM-DD（日切 / 每日限额口径）。 */
export declare function platformDayKey(instant: Date): string;
