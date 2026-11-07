"use strict";
/**
 * 平台时区 = Asia/Shanghai（UTC+8，无夏令时）。
 *
 * 2026-11 第二批归一后，本插件的时间列已统一为 `timestamptz`，pg 驱动读写都是绝对时刻，
 * 不再存在「墙上时间 ↔ 绝对时刻」的换算需求。为兼容既有调用方，下列函数保留原名，
 * 语义退化为恒等 / 直接取 epoch；`platformDayKey` 仍按 Asia/Shanghai 切日。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_TZ_OFFSET_MS = exports.PLATFORM_TIME_ZONE = void 0;
exports.platformWallToInstant = platformWallToInstant;
exports.wallClockMs = wallClockMs;
exports.platformNowMs = platformNowMs;
exports.platformDayKey = platformDayKey;
exports.PLATFORM_TIME_ZONE = 'Asia/Shanghai';
exports.PLATFORM_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const pad2 = (n) => String(n).padStart(2, '0');
/** 列已是 timestamptz：平台墙上时间即绝对时刻，恒等返回。 */
function platformWallToInstant(wall) {
    return wall;
}
/** 绝对时刻的 epoch 毫秒（不再取本地字段拼墙上时间）。 */
function wallClockMs(d) {
    return d.getTime();
}
/** 当前绝对时刻（毫秒）。 */
function platformNowMs() {
    return Date.now();
}
/** 平台时区自然日 key：YYYY-MM-DD（日切 / 每日限额口径）。 */
function platformDayKey(instant) {
    const d = new Date(instant.getTime() + exports.PLATFORM_TZ_OFFSET_MS);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
//# sourceMappingURL=platform-time.js.map