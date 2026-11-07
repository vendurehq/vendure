"use strict";
/**
 * `timestamp without time zone` 列的口径换算（方案 C：应用层止血）。
 *
 * 生产库尚未统一列口径前，同名时间列实际存在两种写入方：
 * - 数据库 `DEFAULT now()` 写入（实体上的 @CreateDateColumn 等）：会话 TimeZone=UTC，
 *   库里存的是「UTC 墙钟」；
 * - 应用 JS `new Date()` 写入：pg 按进程本地时区序列化后 Postgres 丢弃偏移，
 *   库里存的是「北京墙钟」。
 *
 * pg 读回 `timestamp` 时按进程本地时区解析，因此读回 Date 的「本地字段」恒等于库里
 * 的墙钟值，与进程 TZ 无关；是否需要 ±8 小时只取决于该列由谁写入。
 * 本模块只做显式换算，不读取 process.env.TZ。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_TZ_OFFSET_MS = void 0;
exports.dbNowWallToInstant = dbNowWallToInstant;
exports.instantToDbNowWall = instantToDbNowWall;
/** 平台时区偏移（Asia/Shanghai，无夏令时） */
exports.PLATFORM_TZ_OFFSET_MS = 8 * 3600000;
const wallFieldsAsUtc = (wall) => Date.UTC(wall.getFullYear(), wall.getMonth(), wall.getDate(), wall.getHours(), wall.getMinutes(), wall.getSeconds(), wall.getMilliseconds());
/** DB `DEFAULT now()` 写入的列（UTC 墙钟）→ 真实绝对时刻。 */
function dbNowWallToInstant(wall) {
    const d = wall instanceof Date ? wall : new Date(wall);
    return new Date(wallFieldsAsUtc(d));
}
/**
 * 真实绝对时刻 → DB `DEFAULT now()` 列的 UTC 墙钟。
 * 用于把 JS 侧算出的区间端点绑定给 `timestamp` 列比较（否则会被当成北京墙钟、整体偏 8 小时）。
 */
function instantToDbNowWall(instant) {
    return new Date(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate(), instant.getUTCHours(), instant.getUTCMinutes(), instant.getUTCSeconds(), instant.getUTCMilliseconds());
}
//# sourceMappingURL=db-now-wall.js.map