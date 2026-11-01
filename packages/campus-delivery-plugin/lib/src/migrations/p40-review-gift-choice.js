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
exports.P40ReviewGiftChoiceMigration = exports.p40ReviewGiftChoiceSql = void 0;
// §114（2026-11-01）：好评送礼闭环 Review.giftChoice（quality/service/time）。
// 生产 synchronize:false，review-plugin 新增字段必须落物理列，否则 createReview 直接报 column does not exist。
// 幂等（IF NOT EXISTS + to_regclass 判表存在），随服务启动执行。
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
exports.p40ReviewGiftChoiceSql = `
DO $$
BEGIN
  IF to_regclass('review') IS NOT NULL THEN
    ALTER TABLE review ADD COLUMN IF NOT EXISTS "giftChoice" varchar(16);
  END IF;
END $$;
`;
let P40ReviewGiftChoiceMigration = class P40ReviewGiftChoiceMigration {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                await qr.query(exports.p40ReviewGiftChoiceSql);
            }
            finally {
                await qr.release();
            }
        }
        catch (e) {
            // eslint-disable-next-line no-console
            console.error('[P40ReviewGiftChoiceMigration] failed:', e === null || e === void 0 ? void 0 : e.message);
        }
    }
};
exports.P40ReviewGiftChoiceMigration = P40ReviewGiftChoiceMigration;
exports.P40ReviewGiftChoiceMigration = P40ReviewGiftChoiceMigration = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], P40ReviewGiftChoiceMigration);
//# sourceMappingURL=p40-review-gift-choice.js.map