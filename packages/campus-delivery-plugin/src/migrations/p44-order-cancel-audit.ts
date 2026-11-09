// A11（2026-11-09）：强制取消审计表。已送达单一律拦截后台/系统取消，
// 仅 campusForceCancelOrder（带理由）可放行，取消前先落审计（谁/何时/理由/是否已送达）。
// 与 P30 同模式：幂等建表，DB_SYNC=0 时也能上线。
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

export const p44OrderCancelAuditSql = `
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

@Injectable()
export class P44OrderCancelAuditMigration implements OnApplicationBootstrap {
    constructor(@InjectConnection() private connection: Connection) {}

    async onApplicationBootstrap() {
        try {
            const qr = this.connection.createQueryRunner();
            try {
                for (const statement of p44OrderCancelAuditSql.split(';').map(s => s.trim()).filter(Boolean)) {
                    await qr.query(statement);
                }
            } finally {
                await qr.release();
            }
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('[P44OrderCancelAuditMigration] failed:', e?.message);
        }
    }
}
