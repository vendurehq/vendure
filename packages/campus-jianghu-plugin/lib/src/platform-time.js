"use strict";
/**
 * 平台时区 = Asia/Shanghai（UTC+8，1991 年后无夏令时；现网所有门店均在该时区）。
 *
 * 为什么需要这个模块：
 * 本插件的时间列是 `timestamp without time zone`，pg 驱动按「进程本地时区」序列化 Date，
 * 所以库里存的是「平台墙上时间」。而 `new Date()` 是绝对时刻，两者直接 epoch 相减会随
 * 进程 TZ 漂移（进程跑 UTC 时偏 8 小时）。因此所有「行数据时间 vs 现在」的判断都必须
 * 经由本模块换算，不得依赖 process.env.TZ / 浏览器时区。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_TZ_OFFSET_MS = exports.PLATFORM_TIME_ZONE = void 0;
exports.instantToPlatformWall = instantToPlatformWall;
exports.platformWallToInstant = platformWallToInstant;
exports.wallClockMs = wallClockMs;
exports.platformNowMs = platformNowMs;
exports.platformDayKey = platformDayKey;
exports.PLATFORM_TIME_ZONE = 'Asia/Shanghai';
exports.PLATFORM_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const pad2 = (n) => String(n).padStart(2, '0');
/**
 * 绝对时刻 → 平台墙上时间。
 * 返回的 Date 其「本地 getter 字段」（getFullYear/getHours…）等于北京时间墙钟，
 * 用于写入 `timestamp` 列，或在同一口径下与行数据比较。
 */
function instantToPlatformWall(instant) {
    const shifted = new Date(instant.getTime() + exports.PLATFORM_TZ_OFFSET_MS);
    return new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), shifted.getUTCHours(), shifted.getUTCMinutes(), shifted.getUTCSeconds(), shifted.getUTCMilliseconds());
}
/**
 * 平台墙上时间 → 真实绝对时刻。
 * 入参是 `timestamp` 列读回的 Date（本地 getter 字段 = 库里的墙钟）；
 * 返回值的 epoch 才是真实时刻，可直接与 Date.now() 运算。
 */
function platformWallToInstant(wall) {
    const asUtc = Date.UTC(wall.getFullYear(), wall.getMonth(), wall.getDate(), wall.getHours(), wall.getMinutes(), wall.getSeconds(), wall.getMilliseconds());
    return new Date(asUtc - exports.PLATFORM_TZ_OFFSET_MS);
}
/** 把 Date 的「本地字段」当作 UTC 取值：与进程时区无关的墙上时间刻度（毫秒）。 */
function wallClockMs(d) {
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}
/** 平台时区「现在」的墙上时间刻度（毫秒），用于与 `timestamp` 列值比较。 */
function platformNowMs() {
    return wallClockMs(instantToPlatformWall(new Date()));
}
/** 平台时区自然日 key：YYYY-MM-DD（日切/每日限额口径）。 */
function platformDayKey(instant) {
    const d = new Date(instant.getTime() + exports.PLATFORM_TZ_OFFSET_MS);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
//# sourceMappingURL=platform-time.js.map