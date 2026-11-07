"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimezoneDriftCheck = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const constants_1 = require("./constants");
/** 允许的最大偏差：超过即打 error（仅告警，不阻断启动） */
const DRIFT_LIMIT_MS = 60000;
/**
 * 启动自检：数据库 now() 与 Node Date.now() 偏差 > 60 秒打 error。
 *
 * 目的：尽早暴露「进程 TZ / 数据库 TimeZone / 宿主时区」不一致。
 * 这类不一致会让 `timestamp without time zone` 列与 `now()` / JS `Date.now()` 的比较
 * 出现整体偏移（典型为 8 小时），且不会报错，只会让业务判断悄悄错。
 */
let TimezoneDriftCheck = class TimezoneDriftCheck {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        var _a, _b, _c, _d;
        try {
            const before = Date.now();
            const rows = await this.connection.rawConnection.query(`SELECT now() AS db_now, current_setting('TimeZone') AS db_tz`);
            const after = Date.now();
            const row = (_b = (Array.isArray(rows) ? rows[0] : (_a = rows === null || rows === void 0 ? void 0 : rows.rows) === null || _a === void 0 ? void 0 : _a[0])) !== null && _b !== void 0 ? _b : {};
            const dbNowMs = new Date(row.db_now).getTime();
            // 网络往返让 DB now() 略早于 after，取调用前后中点做近似
            const nodeNowMs = (before + after) / 2;
            const driftMs = Math.abs(dbNowMs - nodeNowMs);
            const processTz = (_c = process.env.TZ) !== null && _c !== void 0 ? _c : '(未设置)';
            const processTzOffsetMin = new Date().getTimezoneOffset();
            if (driftMs > DRIFT_LIMIT_MS) {
                core_1.Logger.error(`时区自检失败：DB now() 与 Node Date.now() 偏差 ${driftMs}ms (>${DRIFT_LIMIT_MS}ms)；`
                    + `DB TimeZone=${row.db_tz}，进程 TZ=${processTz}（offset ${processTzOffsetMin}min）`, constants_1.loggerCtx);
            }
            else {
                core_1.Logger.info(`时区自检通过：偏差 ${driftMs}ms；DB TimeZone=${row.db_tz}，`
                    + `进程 TZ=${processTz}（offset ${processTzOffsetMin}min）`, constants_1.loggerCtx);
            }
        }
        catch (e) {
            // 自检失败不能阻断启动
            core_1.Logger.warn(`时区自检跳过（无法查询 now()）：${String((_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : e)}`, constants_1.loggerCtx);
        }
    }
};
exports.TimezoneDriftCheck = TimezoneDriftCheck;
exports.TimezoneDriftCheck = TimezoneDriftCheck = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], TimezoneDriftCheck);
//# sourceMappingURL=timezone-drift-check.js.map