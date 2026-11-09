// p47（2026-11-09）：数据库结构差异清零（只对齐可安全对齐的部分）。
// 背景：启动时 TypeORM 全量 diff 有 1651 条，其中 679 组是时区治理（timestamptz vs timestamp）
// 的结构性差异，由 @vendure/core 的 schema 分类器折叠；本迁移处理余下可安全对齐的六类：
//   1) 33 组手写索引 → 框架同名索引（先建后删，列集与唯一性已逐条比对一致）
//   2) merchant.code / merchant_store.code 唯一约束（加前复查重复值为 0）
//   3) 11 个外键（10 个在 0 行的 *_channels_channel 关联表，1 个孤儿行 0 条）
//   4) 59 条 varchar 长度对齐（涉及表均 < 160 kB，无一条收窄且超长）
//   5) 11 条 NOT NULL / DEFAULT 对齐（SET NOT NULL 前检查空值）
//   6) 元数据里有、库里没有的框架索引
// 全部幂等；反向语句见 p47RollbackSql，回滚时手工执行。死列不删。
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

// 框架元数据索引（含被手工索引替代的那份）：IF NOT EXISTS，重复执行安全
export const p47CreateIndexSql: string[] = [
    `CREATE INDEX IF NOT EXISTS "IDX_af13739f4962eab899bdff34be" ON "order" ("orderPlacedAt")`,
    `CREATE INDEX IF NOT EXISTS "IDX_86bc376c56af8cefd41a847a95" ON "job_record" ("createdAt")`,
    `CREATE INDEX IF NOT EXISTS "IDX_2ffd829d138f3ae05cc68bf812" ON "pickup_location" ("merchantStoreId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_6d4dda428f0dcd3a53ed364f3d" ON "merchant_store" ("merchantId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_39d2ef6c1b2d8627ea02247420" ON "merchant_store_channel" ("storeId", "channelId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_bf2bdec1c65402f5c249188c21" ON "merchant_store_staff" ("storeId", "userId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_24020993d58e60f0e0329d567d" ON "merchant_store_staff" ("storeId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_3533117b62a24d4f6453f0bedd" ON "coupon_store_binding" ("templateId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_d22cc876f09392d93033c15651" ON "coupon_store_binding" ("storeId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_96178e1f8c2d634b050e285fff" ON "coupon_store_binding" ("templateId", "storeId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_24ca4b9e8afb7921f0f7d1789b" ON "coupon_redemption" ("customerCouponId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_8bf9d0d89bb03b5c4762d8d44f" ON "coupon_redemption" ("storeId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_1bc1bb6361b74a4b3518dfe6cc" ON "in_store_bill" ("channelId", "billedAt")`,
    `CREATE INDEX IF NOT EXISTS "IDX_2fdbe0767f419fa3b723493472" ON "after_sales_timeout_task" ("status", "dueAt")`,
    `CREATE INDEX IF NOT EXISTS "IDX_4aae2bd30d0e59a94ca01a9122" ON "points_order_payment" ("channelId", "refundStatus", "updatedAt")`,
    `CREATE INDEX IF NOT EXISTS "IDX_31ffe2dfb8e7782e6a745541ce" ON "service_voucher" ("channelId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_d536c75f5fabb17ba75326011e" ON "service_voucher" ("orderId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_09151abdee3bdf4fdea8dff7f2" ON "service_voucher" ("code")`,
    `CREATE INDEX IF NOT EXISTS "IDX_d78381285add689908303f096a" ON "voucher_booking" ("channelId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_e82409bb8c115888d0269157ae" ON "voucher_booking" ("voucherId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_5e3d3f622b3957604ca28ebd17" ON "subscription_occurrence" ("subscriptionId", "periodNo")`,
    `CREATE INDEX IF NOT EXISTS "IDX_1d12a49afe56009bf247f7c28d" ON "subscription_plan" ("channelId", "shopId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_bb6039cba34a50aba332d831cb" ON "subscription" ("channelId", "customerId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_edfb63b9ae449c5cc2e198587e" ON "bill_pay_order" ("merchantId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_6c3d3108218f60b31e75407075" ON "merchant_agreement" ("merchantId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ff5cf71432c9f928650d56c5e1" ON "campus_compensation_task" ("dedupeKey")`,
    `CREATE INDEX IF NOT EXISTS "IDX_4f2da9c554c50018f43035c3e6" ON "campus_compensation_task" ("status", "nextAttemptAt")`,
    `CREATE INDEX IF NOT EXISTS "idx_campus_ad_channel_slot" ON "campus_ad_campaign" ("channelId", "slot", "status")`,
    `CREATE INDEX IF NOT EXISTS "idx_campus_rider_earning_rider_created" ON "rider_earning" ("riderCustomerId", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "idx_campus_rider_earning_channel_created" ON "rider_earning" ("channelId", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "idx_campus_cod_receipt_payment" ON "campus_cod_receipt" ("paymentId")`,
    `CREATE INDEX IF NOT EXISTS "idx_campus_cod_receipt_order" ON "campus_cod_receipt" ("orderId")`,
    `CREATE INDEX IF NOT EXISTS "idx_campus_cod_receipt_channel" ON "campus_cod_receipt" ("channelId", "status")`,
    `CREATE INDEX IF NOT EXISTS "idx_campus_cod_refund_link_order" ON "campus_cod_refund_link" ("orderId")`,
    `CREATE INDEX IF NOT EXISTS "idx_campus_cod_refund_link_receipt" ON "campus_cod_refund_link" ("receiptId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_e0624b66e3ec03a4bbbfd0c7e0" ON "message_delivery" ("customerId", "readAt")`,
    `CREATE INDEX IF NOT EXISTS "IDX_46803e3d60c3de02858f2fd87e" ON "content_item" ("deletedAt")`,
    `CREATE INDEX IF NOT EXISTS "IDX_43e8b210e76fef208782cd0220" ON "tcm_follow_up_task" ("status", "dueAt")`,
    `CREATE INDEX IF NOT EXISTS "IDX_5d3ac6a5d77a17fe071dffdc0c" ON "wechat_support_ticket" ("status", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "IDX_fb5626dc47efcc5ef926713a91" ON "service_voucher_channels_channel" ("serviceVoucherId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_e83256ebe91c075d27b19b5cc1" ON "service_voucher_channels_channel" ("channelId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_d1268ac5948af882885c9c5365" ON "voucher_booking_channels_channel" ("voucherBookingId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_5077ba82eafa88302abed96366" ON "voucher_booking_channels_channel" ("channelId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_1317b9a2c0ac259c58309fef0c" ON "subscription_occurrence_channels_channel" ("subscriptionOccurrenceId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_9ea710078736142cc8b1b2de5a" ON "subscription_occurrence_channels_channel" ("channelId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_6f1181b0204171ff697d85ec52" ON "subscription_plan_channels_channel" ("subscriptionPlanId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_66d07064cde5f20d9dbeeb2d0e" ON "subscription_plan_channels_channel" ("channelId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_e473e3b1f7215a88a8bd3b2574" ON "subscription_channels_channel" ("subscriptionId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_1bbf78198726f310e3ae31ea2a" ON "subscription_channels_channel" ("channelId")`,
];

// 被完全重复的框架索引替代的手工索引 / 被唯一约束覆盖的手工索引
export const p47DropSupersededIndexSql: string[] = [
    `DROP INDEX IF EXISTS "public"."IDX_campus_cod_receipt_channel"`,
    `DROP INDEX IF EXISTS "public"."IDX_campus_cod_receipt_order"`,
    `DROP INDEX IF EXISTS "public"."IDX_campus_cod_receipt_payment"`,
    `DROP INDEX IF EXISTS "public"."IDX_campus_cod_refund_link_receipt"`,
    `DROP INDEX IF EXISTS "public"."IDX_campus_cod_refund_link_order"`,
    `DROP INDEX IF EXISTS "public"."idx_coupon_store_binding_template"`,
    `DROP INDEX IF EXISTS "public"."idx_coupon_store_binding_store"`,
    `DROP INDEX IF EXISTS "public"."idx_coupon_store_binding_template_store"`,
    `DROP INDEX IF EXISTS "public"."idx_coupon_redemption_coupon"`,
    `DROP INDEX IF EXISTS "public"."idx_coupon_redemption_store"`,
    `DROP INDEX IF EXISTS "public"."idx_service_voucher_code"`,
    `DROP INDEX IF EXISTS "public"."idx_service_voucher_order"`,
    `DROP INDEX IF EXISTS "public"."idx_service_voucher_channel"`,
    `DROP INDEX IF EXISTS "public"."idx_voucher_booking_voucher"`,
    `DROP INDEX IF EXISTS "public"."idx_voucher_booking_channel"`,
    `DROP INDEX IF EXISTS "public"."idx_service_voucher_channels_channel_serviceVoucherId"`,
    `DROP INDEX IF EXISTS "public"."idx_service_voucher_channels_channel_channelId"`,
    `DROP INDEX IF EXISTS "public"."idx_voucher_booking_channels_channel_voucherBookingId"`,
    `DROP INDEX IF EXISTS "public"."idx_voucher_booking_channels_channel_channelId"`,
    `DROP INDEX IF EXISTS "public"."idx_subscription_plan_channel_shop"`,
    `DROP INDEX IF EXISTS "public"."idx_subscription_channel_customer"`,
    `DROP INDEX IF EXISTS "public"."idx_subscription_occurrence_period"`,
    `DROP INDEX IF EXISTS "public"."idx_subscription_plan_channels_channel_subscriptionPlanId"`,
    `DROP INDEX IF EXISTS "public"."idx_subscription_plan_channels_channel_channelId"`,
    `DROP INDEX IF EXISTS "public"."idx_subscription_channels_channel_subscriptionId"`,
    `DROP INDEX IF EXISTS "public"."idx_subscription_channels_channel_channelId"`,
    `DROP INDEX IF EXISTS "public"."idx_subscription_occurrence_channels_channel_subscriptionOccurr"`,
    `DROP INDEX IF EXISTS "public"."idx_subscription_occurrence_channels_channel_channelId"`,
    `DROP INDEX IF EXISTS "public"."IDX_merchant_store_merchantId"`,
    `DROP INDEX IF EXISTS "public"."IDX_merchant_store_channel_store_channel"`,
    `DROP INDEX IF EXISTS "public"."IDX_merchant_store_staff_storeId"`,
    `DROP INDEX IF EXISTS "public"."IDX_merchant_store_staff_store_user"`,
    `DROP INDEX IF EXISTS "public"."idx_pickup_location_merchantStoreId"`,
    `DROP INDEX IF EXISTS "public"."IDX_campus_compensation_dedupe"`,
    `DROP INDEX IF EXISTS "public"."IDX_campus_compensation_due"`,
    `DROP INDEX IF EXISTS "public"."idx_in_store_bill_channel_time"`,
    `DROP INDEX IF EXISTS "public"."IDX_merchant_code"`,
    `DROP INDEX IF EXISTS "public"."IDX_merchant_store_code"`,
];

export const p47VarcharAlignSql = `DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
      ('product', 'customFieldsServicetype', 255),
      ('channel', 'customFieldsReviewgiftqualitycoupontemplateid', 255),
      ('channel', 'customFieldsReviewgiftservicecoupontemplateid', 255),
      ('channel', 'customFieldsReviewgifttimecoupontemplateid', 255),
      ('channel', 'customFieldsWaimaidailypushtime', 255),
      ('channel', 'customFieldsWaimaidailypushlastdate', 255),
      ('channel', 'customFieldsWaimaidailypushlastfailat', 255),
      ('channel', 'customFieldsWaimaidailypushlastfailreason', 255),
      ('channel', 'customFieldsWaimaiaftersalesmonthlypushtime', 255),
      ('channel', 'customFieldsWaimaiaftersalesmonthlypushlastmonth', 255),
      ('channel', 'customFieldsWaimaiaftersalesalertlastday', 255),
      ('campus_review_alert_rule', 'couponTemplateId', NULL),
      ('campus_review_alert', 'couponStatus', NULL),
      ('campus_review_alert', 'couponCode', NULL),
      ('campus_review_alert', 'status', NULL),
      ('coupon_template', 'activityImage', NULL),
      ('coupon_template', 'costBearer', NULL),
      ('coupon_store_binding', 'type', NULL),
      ('coupon_redemption', 'couponCode', NULL),
      ('coupon_redemption', 'redeemMode', NULL),
      ('coupon_redemption', 'operatorName', NULL),
      ('coupon_redemption', 'revokeReason', NULL),
      ('coupon_redemption', 'deviceInfo', NULL),
      ('review', 'giftChoice', NULL),
      ('review', 'appealStatus', NULL),
      ('review', 'appealReviewedBy', NULL),
      ('bill_pay_order', 'couponBearer', NULL),
      ('bill_pay_settlement', 'couponBearer', NULL),
      ('campus_fulfillment_config', 'privacyNumberProvider', NULL),
      ('campus_fulfillment_config', 'privacyNumberPrefix', NULL),
      ('campus_fulfillment_config', 'foodLicenseNo', NULL),
      ('campus_fulfillment_config', 'foodLicenseImage', NULL),
      ('campus_fulfillment_config', 'foodLicenseExpiry', NULL),
      ('campus_fulfillment_config', 'foodSafetyGrade', NULL),
      ('campus_fulfillment_config', 'foodSafetyCommitmentImage', NULL),
      ('campus_fulfillment_config', 'kitchenLiveUrl', NULL),
      ('campus_fulfillment_config', 'packingFeeMode', NULL),
      ('campus_fulfillment_config', 'packingFeeLabel', NULL),
      ('campus_chat_conversation', 'orderCode', NULL),
      ('campus_chat_conversation', 'subject', NULL),
      ('campus_chat_conversation', 'status', NULL),
      ('campus_chat_conversation', 'lastMessage', NULL),
      ('campus_chat_conversation', 'lastSenderType', NULL),
      ('campus_chat_message', 'senderType', NULL),
      ('campus_ad_campaign', 'reviewedBy', NULL),
      ('campus_ad_campaign', 'createdBy', NULL),
      ('campus_cod_receipt', 'orderCode', NULL),
      ('campus_cod_receipt', 'currencyCode', NULL),
      ('campus_cod_receipt', 'method', NULL),
      ('campus_cod_receipt', 'collectedByRole', NULL),
      ('campus_cod_receipt', 'collectedByName', NULL),
      ('campus_cod_receipt', 'source', NULL),
      ('campus_cod_receipt', 'handoverCode', NULL),
      ('campus_cod_receipt', 'voucherNo', NULL),
      ('campus_cod_receipt', 'status', NULL),
      ('campus_cod_receipt', 'voidedByName', NULL),
      ('campus_cod_receipt', 'idempotencyKey', NULL),
      ('campus_cod_refund_link', 'currencyCode', NULL),
      ('campus_cod_refund_link', 'createdByName', NULL)
        ) AS v(tbl, col, len)
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = r.tbl
              AND c.column_name = r.col
              AND (
                  (r.len IS NULL AND c.character_maximum_length IS NOT NULL)
                  OR (r.len IS NOT NULL AND c.character_maximum_length IS DISTINCT FROM r.len)
              )
        ) THEN
            EXECUTE format(
                'ALTER TABLE %I ALTER COLUMN %I TYPE %s',
                r.tbl, r.col,
                CASE WHEN r.len IS NULL THEN 'character varying' ELSE 'character varying(' || r.len || ')' END
            );
        END IF;
    END LOOP;
END $$`;

// 唯一约束与外键：判存在 + 判脏数据，幂等
export const p47ConstraintSql: string[] = [
    `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_17ed216f767e8c37dd24f5c0b95') THEN
        IF EXISTS (
            SELECT 1 FROM (SELECT 1 FROM "merchant" GROUP BY "code" HAVING count(*) > 1) dup
        ) THEN
            RAISE NOTICE '[p47] merchant 存在重复值，跳过唯一约束 UQ_17ed216f767e8c37dd24f5c0b95';
        ELSE
            ALTER TABLE "merchant" ADD CONSTRAINT "UQ_17ed216f767e8c37dd24f5c0b95" UNIQUE ("code");
        END IF;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_393b397eaba89e8033882c9928d') THEN
        IF EXISTS (
            SELECT 1 FROM (SELECT 1 FROM "merchant_store" GROUP BY "code" HAVING count(*) > 1) dup
        ) THEN
            RAISE NOTICE '[p47] merchant_store 存在重复值，跳过唯一约束 UQ_393b397eaba89e8033882c9928d';
        ELSE
            ALTER TABLE "merchant_store" ADD CONSTRAINT "UQ_393b397eaba89e8033882c9928d" UNIQUE ("code");
        END IF;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_6d4dda428f0dcd3a53ed364f3d7') THEN
        IF EXISTS (
            SELECT 1 FROM "merchant_store" c LEFT JOIN "merchant" p ON p."id" = c."merchantId"
            WHERE c."merchantId" IS NOT NULL AND p."id" IS NULL
        ) THEN
            RAISE NOTICE '[p47] merchant_store.merchantId 存在孤儿行，跳过外键 FK_6d4dda428f0dcd3a53ed364f3d7';
        ELSE
            ALTER TABLE "merchant_store" ADD CONSTRAINT "FK_6d4dda428f0dcd3a53ed364f3d7" FOREIGN KEY ("merchantId") REFERENCES "merchant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_fb5626dc47efcc5ef926713a914') THEN
        IF EXISTS (
            SELECT 1 FROM "service_voucher_channels_channel" c LEFT JOIN "service_voucher" p ON p."id" = c."serviceVoucherId"
            WHERE c."serviceVoucherId" IS NOT NULL AND p."id" IS NULL
        ) THEN
            RAISE NOTICE '[p47] service_voucher_channels_channel.serviceVoucherId 存在孤儿行，跳过外键 FK_fb5626dc47efcc5ef926713a914';
        ELSE
            ALTER TABLE "service_voucher_channels_channel" ADD CONSTRAINT "FK_fb5626dc47efcc5ef926713a914" FOREIGN KEY ("serviceVoucherId") REFERENCES "service_voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_e83256ebe91c075d27b19b5cc1f') THEN
        IF EXISTS (
            SELECT 1 FROM "service_voucher_channels_channel" c LEFT JOIN "channel" p ON p."id" = c."channelId"
            WHERE c."channelId" IS NOT NULL AND p."id" IS NULL
        ) THEN
            RAISE NOTICE '[p47] service_voucher_channels_channel.channelId 存在孤儿行，跳过外键 FK_e83256ebe91c075d27b19b5cc1f';
        ELSE
            ALTER TABLE "service_voucher_channels_channel" ADD CONSTRAINT "FK_e83256ebe91c075d27b19b5cc1f" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_d1268ac5948af882885c9c5365a') THEN
        IF EXISTS (
            SELECT 1 FROM "voucher_booking_channels_channel" c LEFT JOIN "voucher_booking" p ON p."id" = c."voucherBookingId"
            WHERE c."voucherBookingId" IS NOT NULL AND p."id" IS NULL
        ) THEN
            RAISE NOTICE '[p47] voucher_booking_channels_channel.voucherBookingId 存在孤儿行，跳过外键 FK_d1268ac5948af882885c9c5365a';
        ELSE
            ALTER TABLE "voucher_booking_channels_channel" ADD CONSTRAINT "FK_d1268ac5948af882885c9c5365a" FOREIGN KEY ("voucherBookingId") REFERENCES "voucher_booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_5077ba82eafa88302abed963662') THEN
        IF EXISTS (
            SELECT 1 FROM "voucher_booking_channels_channel" c LEFT JOIN "channel" p ON p."id" = c."channelId"
            WHERE c."channelId" IS NOT NULL AND p."id" IS NULL
        ) THEN
            RAISE NOTICE '[p47] voucher_booking_channels_channel.channelId 存在孤儿行，跳过外键 FK_5077ba82eafa88302abed963662';
        ELSE
            ALTER TABLE "voucher_booking_channels_channel" ADD CONSTRAINT "FK_5077ba82eafa88302abed963662" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_1317b9a2c0ac259c58309fef0cb') THEN
        IF EXISTS (
            SELECT 1 FROM "subscription_occurrence_channels_channel" c LEFT JOIN "subscription_occurrence" p ON p."id" = c."subscriptionOccurrenceId"
            WHERE c."subscriptionOccurrenceId" IS NOT NULL AND p."id" IS NULL
        ) THEN
            RAISE NOTICE '[p47] subscription_occurrence_channels_channel.subscriptionOccurrenceId 存在孤儿行，跳过外键 FK_1317b9a2c0ac259c58309fef0cb';
        ELSE
            ALTER TABLE "subscription_occurrence_channels_channel" ADD CONSTRAINT "FK_1317b9a2c0ac259c58309fef0cb" FOREIGN KEY ("subscriptionOccurrenceId") REFERENCES "subscription_occurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_9ea710078736142cc8b1b2de5ac') THEN
        IF EXISTS (
            SELECT 1 FROM "subscription_occurrence_channels_channel" c LEFT JOIN "channel" p ON p."id" = c."channelId"
            WHERE c."channelId" IS NOT NULL AND p."id" IS NULL
        ) THEN
            RAISE NOTICE '[p47] subscription_occurrence_channels_channel.channelId 存在孤儿行，跳过外键 FK_9ea710078736142cc8b1b2de5ac';
        ELSE
            ALTER TABLE "subscription_occurrence_channels_channel" ADD CONSTRAINT "FK_9ea710078736142cc8b1b2de5ac" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_6f1181b0204171ff697d85ec52f') THEN
        IF EXISTS (
            SELECT 1 FROM "subscription_plan_channels_channel" c LEFT JOIN "subscription_plan" p ON p."id" = c."subscriptionPlanId"
            WHERE c."subscriptionPlanId" IS NOT NULL AND p."id" IS NULL
        ) THEN
            RAISE NOTICE '[p47] subscription_plan_channels_channel.subscriptionPlanId 存在孤儿行，跳过外键 FK_6f1181b0204171ff697d85ec52f';
        ELSE
            ALTER TABLE "subscription_plan_channels_channel" ADD CONSTRAINT "FK_6f1181b0204171ff697d85ec52f" FOREIGN KEY ("subscriptionPlanId") REFERENCES "subscription_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_66d07064cde5f20d9dbeeb2d0e0') THEN
        IF EXISTS (
            SELECT 1 FROM "subscription_plan_channels_channel" c LEFT JOIN "channel" p ON p."id" = c."channelId"
            WHERE c."channelId" IS NOT NULL AND p."id" IS NULL
        ) THEN
            RAISE NOTICE '[p47] subscription_plan_channels_channel.channelId 存在孤儿行，跳过外键 FK_66d07064cde5f20d9dbeeb2d0e0';
        ELSE
            ALTER TABLE "subscription_plan_channels_channel" ADD CONSTRAINT "FK_66d07064cde5f20d9dbeeb2d0e0" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_e473e3b1f7215a88a8bd3b25749') THEN
        IF EXISTS (
            SELECT 1 FROM "subscription_channels_channel" c LEFT JOIN "subscription" p ON p."id" = c."subscriptionId"
            WHERE c."subscriptionId" IS NOT NULL AND p."id" IS NULL
        ) THEN
            RAISE NOTICE '[p47] subscription_channels_channel.subscriptionId 存在孤儿行，跳过外键 FK_e473e3b1f7215a88a8bd3b25749';
        ELSE
            ALTER TABLE "subscription_channels_channel" ADD CONSTRAINT "FK_e473e3b1f7215a88a8bd3b25749" FOREIGN KEY ("subscriptionId") REFERENCES "subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_1bbf78198726f310e3ae31ea2a1') THEN
        IF EXISTS (
            SELECT 1 FROM "subscription_channels_channel" c LEFT JOIN "channel" p ON p."id" = c."channelId"
            WHERE c."channelId" IS NOT NULL AND p."id" IS NULL
        ) THEN
            RAISE NOTICE '[p47] subscription_channels_channel.channelId 存在孤儿行，跳过外键 FK_1bbf78198726f310e3ae31ea2a1';
        ELSE
            ALTER TABLE "subscription_channels_channel" ADD CONSTRAINT "FK_1bbf78198726f310e3ae31ea2a1" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
    END IF;
END $$`,
];

// NOT NULL / DEFAULT 对齐：SET NOT NULL 前判空
export const p47NullabilitySql: string[] = [
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaidailypushenabled" DROP NOT NULL`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaiaftersalesmonthlypushenabled" DROP NOT NULL`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaiaftersalesautoassignenabled" DROP NOT NULL`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaiaftersalesalertenabled" DROP NOT NULL`,
    `DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "campus_review_alert_rule" WHERE "enabled" IS NULL) THEN
        RAISE NOTICE '[p47] campus_review_alert_rule.enabled 存在 NULL，跳过 SET NOT NULL';
    ELSE
        ALTER TABLE "campus_review_alert_rule" ALTER COLUMN "enabled" SET NOT NULL;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "campus_review_alert_rule" WHERE "maxRating" IS NULL) THEN
        RAISE NOTICE '[p47] campus_review_alert_rule.maxRating 存在 NULL，跳过 SET NOT NULL';
    ELSE
        ALTER TABLE "campus_review_alert_rule" ALTER COLUMN "maxRating" SET NOT NULL;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "campus_fulfillment_config" WHERE "trustQualityEnabled" IS NULL) THEN
        RAISE NOTICE '[p47] campus_fulfillment_config.trustQualityEnabled 存在 NULL，跳过 SET NOT NULL';
    ELSE
        ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "trustQualityEnabled" SET NOT NULL;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "campus_fulfillment_config" WHERE "trustServiceEnabled" IS NULL) THEN
        RAISE NOTICE '[p47] campus_fulfillment_config.trustServiceEnabled 存在 NULL，跳过 SET NOT NULL';
    ELSE
        ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "trustServiceEnabled" SET NOT NULL;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "campus_fulfillment_config" WHERE "trustTimeEnabled" IS NULL) THEN
        RAISE NOTICE '[p47] campus_fulfillment_config.trustTimeEnabled 存在 NULL，跳过 SET NOT NULL';
    ELSE
        ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "trustTimeEnabled" SET NOT NULL;
    END IF;
END $$`,
    `ALTER TABLE "campus_error_report" ALTER COLUMN "level" DROP DEFAULT`,
    `DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "campus_ad_campaign" WHERE "status" IS NULL) THEN
        RAISE NOTICE '[p47] campus_ad_campaign.status 存在 NULL，跳过 SET NOT NULL';
    ELSE
        ALTER TABLE "campus_ad_campaign" ALTER COLUMN "status" SET NOT NULL;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "campus_review_alert" WHERE "couponStatus" IS NULL) THEN
        RAISE NOTICE '[p47] campus_review_alert.couponStatus 存在 NULL，跳过 SET NOT NULL';
    ELSE
        ALTER TABLE "campus_review_alert" ALTER COLUMN "couponStatus" SET NOT NULL;
    END IF;
END $$`,
    `DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "campus_review_alert" WHERE "status" IS NULL) THEN
        RAISE NOTICE '[p47] campus_review_alert.status 存在 NULL，跳过 SET NOT NULL';
    ELSE
        ALTER TABLE "campus_review_alert" ALTER COLUMN "status" SET NOT NULL;
    END IF;
END $$`,
];

// 回滚语句（手工执行，顺序：先恢复索引/列类型，再删约束）
export const p47RollbackSql: string[] = [
    `CREATE INDEX IF NOT EXISTS "IDX_campus_cod_receipt_channel" ON "campus_cod_receipt" ("channelId", "status")`,
    `DROP INDEX IF EXISTS "public"."idx_campus_cod_receipt_channel"`,
    `CREATE INDEX IF NOT EXISTS "IDX_campus_cod_receipt_order" ON "campus_cod_receipt" ("orderId")`,
    `DROP INDEX IF EXISTS "public"."idx_campus_cod_receipt_order"`,
    `CREATE INDEX IF NOT EXISTS "IDX_campus_cod_receipt_payment" ON "campus_cod_receipt" ("paymentId")`,
    `DROP INDEX IF EXISTS "public"."idx_campus_cod_receipt_payment"`,
    `CREATE INDEX IF NOT EXISTS "IDX_campus_cod_refund_link_receipt" ON "campus_cod_refund_link" ("receiptId")`,
    `DROP INDEX IF EXISTS "public"."idx_campus_cod_refund_link_receipt"`,
    `CREATE INDEX IF NOT EXISTS "IDX_campus_cod_refund_link_order" ON "campus_cod_refund_link" ("orderId")`,
    `DROP INDEX IF EXISTS "public"."idx_campus_cod_refund_link_order"`,
    `CREATE INDEX IF NOT EXISTS "idx_coupon_store_binding_template" ON "coupon_store_binding" ("templateId")`,
    `DROP INDEX IF EXISTS "public"."IDX_3533117b62a24d4f6453f0bedd"`,
    `CREATE INDEX IF NOT EXISTS "idx_coupon_store_binding_store" ON "coupon_store_binding" ("storeId")`,
    `DROP INDEX IF EXISTS "public"."IDX_d22cc876f09392d93033c15651"`,
    `CREATE INDEX IF NOT EXISTS "idx_coupon_store_binding_template_store" ON "coupon_store_binding" ("templateId", "storeId")`,
    `DROP INDEX IF EXISTS "public"."IDX_96178e1f8c2d634b050e285fff"`,
    `CREATE INDEX IF NOT EXISTS "idx_coupon_redemption_coupon" ON "coupon_redemption" ("customerCouponId")`,
    `DROP INDEX IF EXISTS "public"."IDX_24ca4b9e8afb7921f0f7d1789b"`,
    `CREATE INDEX IF NOT EXISTS "idx_coupon_redemption_store" ON "coupon_redemption" ("storeId")`,
    `DROP INDEX IF EXISTS "public"."IDX_8bf9d0d89bb03b5c4762d8d44f"`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "idx_service_voucher_code" ON "service_voucher" ("code")`,
    `DROP INDEX IF EXISTS "public"."IDX_09151abdee3bdf4fdea8dff7f2"`,
    `CREATE INDEX IF NOT EXISTS "idx_service_voucher_order" ON "service_voucher" ("orderId")`,
    `DROP INDEX IF EXISTS "public"."IDX_d536c75f5fabb17ba75326011e"`,
    `CREATE INDEX IF NOT EXISTS "idx_service_voucher_channel" ON "service_voucher" ("channelId")`,
    `DROP INDEX IF EXISTS "public"."IDX_31ffe2dfb8e7782e6a745541ce"`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "idx_voucher_booking_voucher" ON "voucher_booking" ("voucherId")`,
    `DROP INDEX IF EXISTS "public"."IDX_e82409bb8c115888d0269157ae"`,
    `CREATE INDEX IF NOT EXISTS "idx_voucher_booking_channel" ON "voucher_booking" ("channelId")`,
    `DROP INDEX IF EXISTS "public"."IDX_d78381285add689908303f096a"`,
    `CREATE INDEX IF NOT EXISTS "idx_service_voucher_channels_channel_serviceVoucherId" ON "service_voucher_channels_channel" ("serviceVoucherId")`,
    `DROP INDEX IF EXISTS "public"."IDX_fb5626dc47efcc5ef926713a91"`,
    `CREATE INDEX IF NOT EXISTS "idx_service_voucher_channels_channel_channelId" ON "service_voucher_channels_channel" ("channelId")`,
    `DROP INDEX IF EXISTS "public"."IDX_e83256ebe91c075d27b19b5cc1"`,
    `CREATE INDEX IF NOT EXISTS "idx_voucher_booking_channels_channel_voucherBookingId" ON "voucher_booking_channels_channel" ("voucherBookingId")`,
    `DROP INDEX IF EXISTS "public"."IDX_d1268ac5948af882885c9c5365"`,
    `CREATE INDEX IF NOT EXISTS "idx_voucher_booking_channels_channel_channelId" ON "voucher_booking_channels_channel" ("channelId")`,
    `DROP INDEX IF EXISTS "public"."IDX_5077ba82eafa88302abed96366"`,
    `CREATE INDEX IF NOT EXISTS "idx_subscription_plan_channel_shop" ON "subscription_plan" ("channelId", "shopId")`,
    `DROP INDEX IF EXISTS "public"."IDX_1d12a49afe56009bf247f7c28d"`,
    `CREATE INDEX IF NOT EXISTS "idx_subscription_channel_customer" ON "subscription" ("channelId", "customerId")`,
    `DROP INDEX IF EXISTS "public"."IDX_bb6039cba34a50aba332d831cb"`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "idx_subscription_occurrence_period" ON "subscription_occurrence" ("subscriptionId", "periodNo")`,
    `DROP INDEX IF EXISTS "public"."IDX_5e3d3f622b3957604ca28ebd17"`,
    `CREATE INDEX IF NOT EXISTS "idx_subscription_plan_channels_channel_subscriptionPlanId" ON "subscription_plan_channels_channel" ("subscriptionPlanId")`,
    `DROP INDEX IF EXISTS "public"."IDX_6f1181b0204171ff697d85ec52"`,
    `CREATE INDEX IF NOT EXISTS "idx_subscription_plan_channels_channel_channelId" ON "subscription_plan_channels_channel" ("channelId")`,
    `DROP INDEX IF EXISTS "public"."IDX_66d07064cde5f20d9dbeeb2d0e"`,
    `CREATE INDEX IF NOT EXISTS "idx_subscription_channels_channel_subscriptionId" ON "subscription_channels_channel" ("subscriptionId")`,
    `DROP INDEX IF EXISTS "public"."IDX_e473e3b1f7215a88a8bd3b2574"`,
    `CREATE INDEX IF NOT EXISTS "idx_subscription_channels_channel_channelId" ON "subscription_channels_channel" ("channelId")`,
    `DROP INDEX IF EXISTS "public"."IDX_1bbf78198726f310e3ae31ea2a"`,
    `CREATE INDEX IF NOT EXISTS "idx_subscription_occurrence_channels_channel_subscriptionOccurr" ON "subscription_occurrence_channels_channel" ("subscriptionOccurrenceId")`,
    `DROP INDEX IF EXISTS "public"."IDX_1317b9a2c0ac259c58309fef0c"`,
    `CREATE INDEX IF NOT EXISTS "idx_subscription_occurrence_channels_channel_channelId" ON "subscription_occurrence_channels_channel" ("channelId")`,
    `DROP INDEX IF EXISTS "public"."IDX_9ea710078736142cc8b1b2de5a"`,
    `CREATE INDEX IF NOT EXISTS "IDX_merchant_store_merchantId" ON "merchant_store" ("merchantId")`,
    `DROP INDEX IF EXISTS "public"."IDX_6d4dda428f0dcd3a53ed364f3d"`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_merchant_store_channel_store_channel" ON "merchant_store_channel" ("storeId", "channelId")`,
    `DROP INDEX IF EXISTS "public"."IDX_39d2ef6c1b2d8627ea02247420"`,
    `CREATE INDEX IF NOT EXISTS "IDX_merchant_store_staff_storeId" ON "merchant_store_staff" ("storeId")`,
    `DROP INDEX IF EXISTS "public"."IDX_24020993d58e60f0e0329d567d"`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_merchant_store_staff_store_user" ON "merchant_store_staff" ("storeId", "userId")`,
    `DROP INDEX IF EXISTS "public"."IDX_bf2bdec1c65402f5c249188c21"`,
    `CREATE INDEX IF NOT EXISTS "idx_pickup_location_merchantStoreId" ON "pickup_location" ("merchantStoreId")`,
    `DROP INDEX IF EXISTS "public"."IDX_2ffd829d138f3ae05cc68bf812"`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_campus_compensation_dedupe" ON "campus_compensation_task" ("dedupeKey")`,
    `DROP INDEX IF EXISTS "public"."IDX_ff5cf71432c9f928650d56c5e1"`,
    `CREATE INDEX IF NOT EXISTS "IDX_campus_compensation_due" ON "campus_compensation_task" ("status", "nextAttemptAt")`,
    `DROP INDEX IF EXISTS "public"."IDX_4f2da9c554c50018f43035c3e6"`,
    `CREATE INDEX IF NOT EXISTS "idx_in_store_bill_channel_time" ON "in_store_bill" ("channelId", "billedAt")`,
    `DROP INDEX IF EXISTS "public"."IDX_1bc1bb6361b74a4b3518dfe6cc"`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_merchant_code" ON "merchant" (code)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_merchant_store_code" ON "merchant_store" (code)`,
    `ALTER TABLE "merchant" DROP CONSTRAINT IF EXISTS "UQ_17ed216f767e8c37dd24f5c0b95"`,
    `ALTER TABLE "merchant_store" DROP CONSTRAINT IF EXISTS "UQ_393b397eaba89e8033882c9928d"`,
    `ALTER TABLE "merchant_store" DROP CONSTRAINT IF EXISTS "FK_6d4dda428f0dcd3a53ed364f3d7"`,
    `ALTER TABLE "service_voucher_channels_channel" DROP CONSTRAINT IF EXISTS "FK_fb5626dc47efcc5ef926713a914"`,
    `ALTER TABLE "service_voucher_channels_channel" DROP CONSTRAINT IF EXISTS "FK_e83256ebe91c075d27b19b5cc1f"`,
    `ALTER TABLE "voucher_booking_channels_channel" DROP CONSTRAINT IF EXISTS "FK_d1268ac5948af882885c9c5365a"`,
    `ALTER TABLE "voucher_booking_channels_channel" DROP CONSTRAINT IF EXISTS "FK_5077ba82eafa88302abed963662"`,
    `ALTER TABLE "subscription_occurrence_channels_channel" DROP CONSTRAINT IF EXISTS "FK_1317b9a2c0ac259c58309fef0cb"`,
    `ALTER TABLE "subscription_occurrence_channels_channel" DROP CONSTRAINT IF EXISTS "FK_9ea710078736142cc8b1b2de5ac"`,
    `ALTER TABLE "subscription_plan_channels_channel" DROP CONSTRAINT IF EXISTS "FK_6f1181b0204171ff697d85ec52f"`,
    `ALTER TABLE "subscription_plan_channels_channel" DROP CONSTRAINT IF EXISTS "FK_66d07064cde5f20d9dbeeb2d0e0"`,
    `ALTER TABLE "subscription_channels_channel" DROP CONSTRAINT IF EXISTS "FK_e473e3b1f7215a88a8bd3b25749"`,
    `ALTER TABLE "subscription_channels_channel" DROP CONSTRAINT IF EXISTS "FK_1bbf78198726f310e3ae31ea2a1"`,
    `ALTER TABLE "product" ALTER COLUMN "customFieldsServicetype" TYPE character varying`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsReviewgiftqualitycoupontemplateid" TYPE character varying`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsReviewgiftservicecoupontemplateid" TYPE character varying`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsReviewgifttimecoupontemplateid" TYPE character varying`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaidailypushtime" TYPE character varying(5)`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaidailypushlastdate" TYPE character varying(10)`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaidailypushlastfailat" TYPE character varying(16)`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaidailypushlastfailreason" TYPE character varying(200)`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaiaftersalesmonthlypushtime" TYPE character varying(5)`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaiaftersalesmonthlypushlastmonth" TYPE character varying(7)`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaiaftersalesalertlastday" TYPE character varying(10)`,
    `ALTER TABLE "campus_review_alert_rule" ALTER COLUMN "couponTemplateId" TYPE character varying(255)`,
    `ALTER TABLE "campus_review_alert" ALTER COLUMN "couponStatus" TYPE character varying(255)`,
    `ALTER TABLE "campus_review_alert" ALTER COLUMN "couponCode" TYPE character varying(255)`,
    `ALTER TABLE "campus_review_alert" ALTER COLUMN "status" TYPE character varying(255)`,
    `ALTER TABLE "coupon_template" ALTER COLUMN "activityImage" TYPE character varying(1024)`,
    `ALTER TABLE "coupon_template" ALTER COLUMN "costBearer" TYPE character varying(16)`,
    `ALTER TABLE "coupon_store_binding" ALTER COLUMN "type" TYPE character varying(16)`,
    `ALTER TABLE "coupon_redemption" ALTER COLUMN "couponCode" TYPE character varying(255)`,
    `ALTER TABLE "coupon_redemption" ALTER COLUMN "redeemMode" TYPE character varying(16)`,
    `ALTER TABLE "coupon_redemption" ALTER COLUMN "operatorName" TYPE character varying(255)`,
    `ALTER TABLE "coupon_redemption" ALTER COLUMN "revokeReason" TYPE character varying(255)`,
    `ALTER TABLE "coupon_redemption" ALTER COLUMN "deviceInfo" TYPE character varying(255)`,
    `ALTER TABLE "review" ALTER COLUMN "giftChoice" TYPE character varying(16)`,
    `ALTER TABLE "review" ALTER COLUMN "appealStatus" TYPE character varying(16)`,
    `ALTER TABLE "review" ALTER COLUMN "appealReviewedBy" TYPE character varying(64)`,
    `ALTER TABLE "bill_pay_settlement" ALTER COLUMN "couponBearer" TYPE character varying(16)`,
    `ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "privacyNumberProvider" TYPE character varying(32)`,
    `ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "privacyNumberPrefix" TYPE character varying(32)`,
    `ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "foodLicenseNo" TYPE character varying(64)`,
    `ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "foodLicenseImage" TYPE character varying(512)`,
    `ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "foodLicenseExpiry" TYPE character varying(16)`,
    `ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "foodSafetyGrade" TYPE character varying(8)`,
    `ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "foodSafetyCommitmentImage" TYPE character varying(512)`,
    `ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "kitchenLiveUrl" TYPE character varying(512)`,
    `ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "packingFeeMode" TYPE character varying(16)`,
    `ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "packingFeeLabel" TYPE character varying(32)`,
    `ALTER TABLE "campus_chat_conversation" ALTER COLUMN "orderCode" TYPE character varying(64)`,
    `ALTER TABLE "campus_chat_conversation" ALTER COLUMN "subject" TYPE character varying(128)`,
    `ALTER TABLE "campus_chat_conversation" ALTER COLUMN "status" TYPE character varying(16)`,
    `ALTER TABLE "campus_chat_conversation" ALTER COLUMN "lastMessage" TYPE character varying(200)`,
    `ALTER TABLE "campus_chat_conversation" ALTER COLUMN "lastSenderType" TYPE character varying(16)`,
    `ALTER TABLE "campus_chat_message" ALTER COLUMN "senderType" TYPE character varying(16)`,
    `ALTER TABLE "campus_ad_campaign" ALTER COLUMN "reviewedBy" TYPE character varying(255)`,
    `ALTER TABLE "campus_ad_campaign" ALTER COLUMN "createdBy" TYPE character varying(255)`,
    `ALTER TABLE "campus_cod_receipt" ALTER COLUMN "orderCode" TYPE character varying(64)`,
    `ALTER TABLE "campus_cod_receipt" ALTER COLUMN "currencyCode" TYPE character varying(16)`,
    `ALTER TABLE "campus_cod_receipt" ALTER COLUMN "method" TYPE character varying(16)`,
    `ALTER TABLE "campus_cod_receipt" ALTER COLUMN "collectedByRole" TYPE character varying(16)`,
    `ALTER TABLE "campus_cod_receipt" ALTER COLUMN "collectedByName" TYPE character varying(128)`,
    `ALTER TABLE "campus_cod_receipt" ALTER COLUMN "source" TYPE character varying(32)`,
    `ALTER TABLE "campus_cod_receipt" ALTER COLUMN "handoverCode" TYPE character varying(64)`,
    `ALTER TABLE "campus_cod_receipt" ALTER COLUMN "voucherNo" TYPE character varying(128)`,
    `ALTER TABLE "campus_cod_receipt" ALTER COLUMN "status" TYPE character varying(16)`,
    `ALTER TABLE "campus_cod_receipt" ALTER COLUMN "voidedByName" TYPE character varying(128)`,
    `ALTER TABLE "campus_cod_receipt" ALTER COLUMN "idempotencyKey" TYPE character varying(160)`,
    `ALTER TABLE "campus_cod_refund_link" ALTER COLUMN "currencyCode" TYPE character varying(16)`,
    `ALTER TABLE "campus_cod_refund_link" ALTER COLUMN "createdByName" TYPE character varying(128)`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaidailypushenabled" SET NOT NULL`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaiaftersalesmonthlypushenabled" SET NOT NULL`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaiaftersalesautoassignenabled" SET NOT NULL`,
    `ALTER TABLE "channel" ALTER COLUMN "customFieldsWaimaiaftersalesalertenabled" SET NOT NULL`,
    `ALTER TABLE "campus_review_alert_rule" ALTER COLUMN "enabled" SET NOT NULL`,
    `ALTER TABLE "campus_review_alert_rule" ALTER COLUMN "maxRating" SET NOT NULL`,
    `ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "trustQualityEnabled" SET NOT NULL`,
    `ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "trustServiceEnabled" SET NOT NULL`,
    `ALTER TABLE "campus_fulfillment_config" ALTER COLUMN "trustTimeEnabled" SET NOT NULL`,
    `ALTER TABLE "campus_ad_campaign" ALTER COLUMN "status" SET NOT NULL`,
    `ALTER TABLE "campus_review_alert" ALTER COLUMN "couponStatus" DROP NOT NULL`,
    `ALTER TABLE "campus_review_alert" ALTER COLUMN "status" DROP NOT NULL`,
];


@Injectable()
export class P47SchemaDiffAlignmentMigration implements OnApplicationBootstrap {
    constructor(@InjectConnection() private connection: Connection) {}

    async onApplicationBootstrap() {
        const qr = this.connection.createQueryRunner();
        let created = 0;
        let dropped = 0;
        let constraints = 0;
        try {
            for (const statement of p47CreateIndexSql) {
                const before = await qr.query(
                    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
                    [/"([^"]+)"/.exec(statement)?.[1]],
                );
                await qr.query(statement);
                if (!before.length) {
                    created++;
                }
            }
            for (const statement of p47DropSupersededIndexSql) {
                await qr.query(statement);
                dropped++;
            }
            await qr.query(p47VarcharAlignSql);
            for (const statement of p47ConstraintSql) {
                const before = await qr.query(
                    `SELECT 1 FROM pg_constraint WHERE conname = $1`,
                    [/CONSTRAINT "([^"]+)"/.exec(statement)?.[1]],
                );
                await qr.query(statement);
                if (!before.length) {
                    constraints++;
                }
            }
            for (const statement of p47NullabilitySql) {
                await qr.query(statement);
            }
            // eslint-disable-next-line no-console
            console.log(
                `[P47SchemaDiffAlignmentMigration] 完成：新建索引 ${created} 个，删除重复索引 ${dropped} 个，新增约束 ${constraints} 个，varchar 对齐 ${varcharTargetCount} 列`,
            );
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('[P47SchemaDiffAlignmentMigration] failed:', e?.message);
        } finally {
            await qr.release();
        }
    }
}

const varcharTargetCount = 59;
