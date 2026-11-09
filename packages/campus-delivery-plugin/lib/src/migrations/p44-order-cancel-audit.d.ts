import { OnApplicationBootstrap } from '@nestjs/common';
import { Connection } from 'typeorm';
export declare const p44OrderCancelAuditSql = "\nCREATE TABLE IF NOT EXISTS campus_order_cancel_audit_log (\n  id serial PRIMARY KEY,\n  \"orderId\" integer NOT NULL,\n  \"orderCode\" varchar(64) NOT NULL,\n  \"channelId\" integer,\n  \"actorUserId\" integer,\n  delivered boolean NOT NULL DEFAULT false,\n  reason text NOT NULL,\n  outcome varchar(16) NOT NULL DEFAULT 'pending',\n  error text,\n  \"createdAt\" timestamptz NOT NULL DEFAULT now()\n);\nCREATE INDEX IF NOT EXISTS campus_order_cancel_audit_log_order\n  ON campus_order_cancel_audit_log (\"orderId\", \"createdAt\");\nCREATE INDEX IF NOT EXISTS campus_order_cancel_audit_log_created\n  ON campus_order_cancel_audit_log (\"createdAt\")\n";
export declare class P44OrderCancelAuditMigration implements OnApplicationBootstrap {
    private connection;
    constructor(connection: Connection);
    onApplicationBootstrap(): Promise<void>;
}
