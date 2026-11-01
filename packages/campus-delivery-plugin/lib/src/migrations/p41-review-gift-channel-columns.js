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
exports.P41ReviewGiftChannelColumnsMigration = exports.p41ReviewGiftChannelColumnsSql = void 0;
// §114（2026-11-01）：好评送礼三档礼包券模板是 Channel customFields，生产 synchronize:false
// 不会自动建列，缺列会让任何 Channel 查询直接报 column does not exist（服务启动即崩）。
// 列名规则：customFields + 首字母大写其余小写（与既有 customFieldsReviewgiftcoupontemplateid 一致）。
// 幂等（IF NOT EXISTS），随服务启动执行。
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
exports.p41ReviewGiftChannelColumnsSql = `
DO $$
BEGIN
  IF to_regclass('channel') IS NOT NULL THEN
    ALTER TABLE channel ADD COLUMN IF NOT EXISTS "customFieldsReviewgiftqualitycoupontemplateid" varchar;
    ALTER TABLE channel ADD COLUMN IF NOT EXISTS "customFieldsReviewgiftservicecoupontemplateid" varchar;
    ALTER TABLE channel ADD COLUMN IF NOT EXISTS "customFieldsReviewgifttimecoupontemplateid" varchar;
  END IF;
END $$;
`;
let P41ReviewGiftChannelColumnsMigration = class P41ReviewGiftChannelColumnsMigration {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                await qr.query(exports.p41ReviewGiftChannelColumnsSql);
            }
            finally {
                await qr.release();
            }
        }
        catch (e) {
            // eslint-disable-next-line no-console
            console.error('[P41ReviewGiftChannelColumnsMigration] failed:', e === null || e === void 0 ? void 0 : e.message);
        }
    }
};
exports.P41ReviewGiftChannelColumnsMigration = P41ReviewGiftChannelColumnsMigration;
exports.P41ReviewGiftChannelColumnsMigration = P41ReviewGiftChannelColumnsMigration = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], P41ReviewGiftChannelColumnsMigration);
//# sourceMappingURL=p41-review-gift-channel-columns.js.map