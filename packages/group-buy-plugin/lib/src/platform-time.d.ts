/**
 * 平台时区 = Asia/Shanghai（UTC+8，1991 年后无夏令时；现网所有门店均在该时区）。
 *
 * 为什么需要这个模块：
 * 本插件的时间列是 `timestamp without time zone`，pg 驱动按「进程本地时区」序列化 Date，
 * 所以库里存的是「平台墙上时间」。而 `new Date()` 是绝对时刻，两者直接 epoch 相减会随
 * 进程 TZ 漂移（进程跑 UTC 时偏 8 小时）。因此所有「行数据时间 vs 现在」的判断都必须
 * 经由本模块换算，不得依赖 process.env.TZ / 浏览器时区。
 */
export declare const PLATFORM_TIME_ZONE = "Asia/Shanghai";
export declare const PLATFORM_TZ_OFFSET_MS: number;
/**
 * 绝对时刻 → 平台墙上时间。
 * 返回的 Date 其「本地 getter 字段」（getFullYear/getHours…）等于北京时间墙钟，
 * 用于写入 `timestamp` 列，或在同一口径下与行数据比较。
 */
export declare function instantToPlatformWall(instant: Date): Date;
/**
 * 平台墙上时间 → 真实绝对时刻。
 * 入参是 `timestamp` 列读回的 Date（本地 getter 字段 = 库里的墙钟）；
 * 返回值的 epoch 才是真实时刻，可直接与 Date.now() 运算。
 */
export declare function platformWallToInstant(wall: Date): Date;
/** 把 Date 的「本地字段」当作 UTC 取值：与进程时区无关的墙上时间刻度（毫秒）。 */
export declare function wallClockMs(d: Date): number;
/** 平台时区「现在」的墙上时间刻度（毫秒），用于与 `timestamp` 列值比较。 */
export declare function platformNowMs(): number;
/** 平台时区自然日 key：YYYY-MM-DD（日切/每日限额口径）。 */
export declare function platformDayKey(instant: Date): string;
