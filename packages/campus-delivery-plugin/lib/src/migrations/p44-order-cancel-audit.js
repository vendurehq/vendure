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
exports.P44OrderCancelAuditMigration = exports.p44OrderCancelAuditSql = void 0;
// A11（2026-11-09）：强制取消审计表。已送达单一律拦截后台/系统取消，
// 仅 campusForceCancelOrder（带理由）可放行，取消前先落审计（谁/何时/理由/是否已送达）。
// 与 P30 同模式：幂等建表，DB_SYNC=0 时也能上线。
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
exports.p44OrderCancelAuditSql = `
CREATE TABLE IF NOT EXISTS campus_order_cancel_audit_log (
  id serial PRIMARY KEY,
  "orderId" integer NOT NULL,
  "orderCode" varchar(64) NOT NULL,
  "channelId" integer,
  "actorUserId" integer,
  delivered boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  outcome varchar(16) NOT NULL DEFAULT 'pending',
  error text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campus_order_cancel_audit_log_order
  ON campus_order_cancel_audit_log ("orderId", "createdAt");
CREATE INDEX IF NOT EXISTS campus_order_cancel_audit_log_created
  ON campus_order_cancel_audit_log ("createdAt")
`;
let P44OrderCancelAuditMigration = class P44OrderCancelAuditMigration {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                for (const statement of exports.p44OrderCancelAuditSql.split(';').map(s => s.trim()).filter(Boolean)) {
                    await qr.query(statement);
                }
            }
            finally {
                await qr.release();
            }
        }
        catch (e) {
            // eslint-disable-next-line no-console
            console.error('[P44OrderCancelAuditMigration] failed:', e === null || e === void 0 ? void 0 : e.message);
        }
    }
};
exports.P44OrderCancelAuditMigration = P44OrderCancelAuditMigration;
exports.P44OrderCancelAuditMigration = P44OrderCancelAuditMigration = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], P44OrderCancelAuditMigration);
//# sourceMappingURL=p44-order-cancel-audit.js.map