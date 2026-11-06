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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.P42ChannelAfterSalesRuleColumnsMigration = exports.p42ChannelAfterSalesRuleColumnsSql = void 0;
// §126（2026-11-01）：售后规则三项阈值是 Channel customFields，生产 synchronize:false 不会自动建列，
// 缺列会让任何 Channel 查询报 column does not exist（服务启动即崩），故必须先补物理列。
// 列名规则：customFields + 首字母大写其余小写（与既有 customFieldsAftersalestimeouthours 一致）。
// 幂等（IF NOT EXISTS），随服务启动执行；生产上线前另已手工执行同一 DDL。
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
exports.p42ChannelAfterSalesRuleColumnsSql = `
DO $$
BEGIN
  IF to_regclass('channel') IS NOT NULL THEN
    ALTER TABLE channel ADD COLUMN IF NOT EXISTS "customFieldsAftersalesduesoonhours" int;
    ALTER TABLE channel ADD COLUMN IF NOT EXISTS "customFieldsAftersalesfirstresponsetargethours" int;
    ALTER TABLE channel ADD COLUMN IF NOT EXISTS "customFieldsAftersalesresolvetargethours" int;
  END IF;
END $$;
`;
let P42ChannelAfterSalesRuleColumnsMigration = class P42ChannelAfterSalesRuleColumnsMigration {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                await qr.query(exports.p42ChannelAfterSalesRuleColumnsSql);
            }
            finally {
                await qr.release();
            }
        }
        catch (e) {
            // eslint-disable-next-line no-console
            console.error('[P42ChannelAfterSalesRuleColumnsMigration] failed:', e === null || e === void 0 ? void 0 : e.message);
        }
    }
};
exports.P42ChannelAfterSalesRuleColumnsMigration = P42ChannelAfterSalesRuleColumnsMigration;
exports.P42ChannelAfterSalesRuleColumnsMigration = P42ChannelAfterSalesRuleColumnsMigration = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], P42ChannelAfterSalesRuleColumnsMigration);
//# sourceMappingURL=p42-channel-aftersales-rule-columns.js.map