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
exports.P45CodReceiptLedgerMigration = exports.p45CodReceiptLedgerSql = void 0;
// A12（2026-11-09）：货到付款现金收款台账 + 退款关联表。
// 原则：先有收款记录，才能记载退款记录；退款必须引用一笔 confirmed 收款。
// 与 P30/P44 同模式：幂等建表，DB_SYNC=0 时也能上线。历史数据不做回填。
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
exports.p45CodReceiptLedgerSql = `
CREATE TABLE IF NOT EXISTS campus_cod_receipt (
  id serial PRIMARY KEY,
  "channelId" integer NOT NULL,
  "orderId" integer,
  "orderCode" varchar(64),
  "paymentId" integer NOT NULL,
  amount integer NOT NULL,
  "currencyCode" varchar(16) NOT NULL DEFAULT 'CNY',
  method varchar(16) NOT NULL DEFAULT 'cash',
  "collectedAt" timestamptz NOT NULL,
  "collectedByRole" varchar(16) NOT NULL,
  "collectedById" integer,
  "collectedByName" varchar(128),
  source varchar(32) NOT NULL,
  "deliveryOrderId" integer,
  "handoverCode" varchar(64),
  "deliveryRecordId" integer,
  "voucherNo" varchar(128),
  images text,
  note text,
  status varchar(16) NOT NULL DEFAULT 'confirmed',
  "voidedAt" timestamptz,
  "voidedById" integer,
  "voidedByName" varchar(128),
  "voidReason" text,
  "idempotencyKey" varchar(160),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_campus_cod_receipt_payment_confirmed"
  ON campus_cod_receipt ("paymentId") WHERE status = 'confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_campus_cod_receipt_idem"
  ON campus_cod_receipt ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "IDX_campus_cod_receipt_channel"
  ON campus_cod_receipt ("channelId", status);
CREATE INDEX IF NOT EXISTS "IDX_campus_cod_receipt_order"
  ON campus_cod_receipt ("orderId");
CREATE INDEX IF NOT EXISTS "IDX_campus_cod_receipt_payment"
  ON campus_cod_receipt ("paymentId");
CREATE INDEX IF NOT EXISTS "IDX_campus_cod_receipt_collected"
  ON campus_cod_receipt ("collectedAt");

CREATE TABLE IF NOT EXISTS campus_cod_refund_link (
  id serial PRIMARY KEY,
  "refundId" integer NOT NULL,
  "receiptId" integer NOT NULL,
  "orderId" integer,
  "paymentId" integer NOT NULL,
  "amountApplied" integer NOT NULL,
  "currencyCode" varchar(16) NOT NULL DEFAULT 'CNY',
  "createdById" integer,
  "createdByName" varchar(128),
  note text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_campus_cod_refund_link_refund"
  ON campus_cod_refund_link ("refundId");
CREATE INDEX IF NOT EXISTS "IDX_campus_cod_refund_link_receipt"
  ON campus_cod_refund_link ("receiptId");
CREATE INDEX IF NOT EXISTS "IDX_campus_cod_refund_link_order"
  ON campus_cod_refund_link ("orderId");
CREATE INDEX IF NOT EXISTS "IDX_campus_cod_refund_link_payment"
  ON campus_cod_refund_link ("paymentId");
`;
let P45CodReceiptLedgerMigration = class P45CodReceiptLedgerMigration {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                for (const statement of exports.p45CodReceiptLedgerSql
                    .split(';')
                    .map(s => s.trim())
                    .filter(Boolean)) {
                    await qr.query(statement);
                }
            }
            finally {
                await qr.release();
            }
        }
        catch (e) {
            // eslint-disable-next-line no-console
            console.error('[P45CodReceiptLedgerMigration] failed:', e === null || e === void 0 ? void 0 : e.message);
        }
    }
};
exports.P45CodReceiptLedgerMigration = P45CodReceiptLedgerMigration;
exports.P45CodReceiptLedgerMigration = P45CodReceiptLedgerMigration = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], P45CodReceiptLedgerMigration);
//# sourceMappingURL=p45-cod-receipt-ledger.js.map