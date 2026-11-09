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
exports.SubscriptionTablesMigration = void 0;
// 幂等补建订阅三张表及其渠道关联表（SubscriptionPlugin 首次上线）。
// 生产（PostgreSQL）与本地开发（SQLite）都可能关闭 synchronize，故用 IF NOT EXISTS 兜底；
// 列名/类型与 subscription-plan/subscription/subscription-occurrence 实体及 TypeORM 默认命名对齐。
// simple-json 列统一用 text 承载。建表失败不阻塞启动，等待下次启动重试。
// 注意：本迁移只建表，不建索引。框架命名索引（IDX_*）由实体 @Index 元数据统一维护，
// 手工命名的 idx_subscription_* 会与框架索引重复，p47 每次启动都会删除它们，
// 若此处继续创建会形成「删了又建」的互踩，导致启动差异告警长期非零。
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
function isPostgres(driver) {
    return driver === 'postgres' || driver === 'postgresql';
}
let SubscriptionTablesMigration = class SubscriptionTablesMigration {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        const queryRunner = this.connection.createQueryRunner();
        try {
            const pg = isPostgres(this.connection.options.type);
            const pk = pg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
            const ts = pg ? 'timestamp' : 'datetime';
            const now = pg ? 'now()' : 'CURRENT_TIMESTAMP';
            const Q = (s) => `"${s}"`;
            const base = `${Q('id')} ${pk}, ` +
                `${Q('createdAt')} ${ts} NOT NULL DEFAULT ${now}, ` +
                `${Q('updatedAt')} ${ts} NOT NULL DEFAULT ${now}, ` +
                `${Q('deletedAt')} ${ts} NULL, `;
            await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${Q('subscription_plan')} (` +
                base +
                `${Q('channelId')} integer NOT NULL, ` +
                `${Q('shopId')} integer NOT NULL, ` +
                `${Q('title')} varchar NOT NULL, ` +
                `${Q('description')} varchar NULL, ` +
                `${Q('frequency')} text NOT NULL, ` +
                `${Q('periods')} integer NOT NULL, ` +
                `${Q('periodPrice')} integer NOT NULL, ` +
                `${Q('templateItems')} text NULL, ` +
                `${Q('enabled')} boolean NOT NULL DEFAULT ${pg ? 'true' : '1'})`);
            await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${Q('subscription')} (` +
                base +
                `${Q('channelId')} integer NOT NULL, ` +
                `${Q('code')} varchar NOT NULL, ` +
                `${Q('planId')} integer NOT NULL, ` +
                `${Q('shopId')} integer NOT NULL, ` +
                `${Q('customerId')} integer NOT NULL, ` +
                `${Q('scheduleJson')} text NOT NULL, ` +
                `${Q('startDate')} ${ts} NULL, ` +
                `${Q('endDate')} ${ts} NULL, ` +
                `${Q('prepaidBalance')} integer NOT NULL DEFAULT 0, ` +
                `${Q('purchasedTotal')} integer NOT NULL DEFAULT 0, ` +
                `${Q('payOrderId')} integer NULL, ` +
                `${Q('status')} varchar NOT NULL DEFAULT 'draft')`);
            await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${Q('subscription_occurrence')} (` +
                base +
                `${Q('channelId')} integer NOT NULL, ` +
                `${Q('subscriptionId')} integer NOT NULL, ` +
                `${Q('periodNo')} integer NOT NULL, ` +
                `${Q('scheduledDate')} ${ts} NOT NULL, ` +
                `${Q('sellerItemsJson')} text NULL, ` +
                `${Q('generatedOrderId')} integer NULL, ` +
                `${Q('orderCode')} varchar NULL, ` +
                `${Q('skipReason')} varchar NULL, ` +
                `${Q('status')} varchar NOT NULL DEFAULT 'pending')`);
            for (const [joinTable, ownerCol] of [
                ['subscription_plan_channels_channel', 'subscriptionPlanId'],
                ['subscription_channels_channel', 'subscriptionId'],
                ['subscription_occurrence_channels_channel', 'subscriptionOccurrenceId'],
            ]) {
                await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${Q(joinTable)} (` +
                    `${Q(ownerCol)} integer NOT NULL, ` +
                    `${Q('channelId')} integer NOT NULL, ` +
                    `PRIMARY KEY (${Q(ownerCol)}, ${Q('channelId')}))`);
            }
        }
        catch (e) {
            // eslint-disable-next-line no-console
            console.error('[SubscriptionTablesMigration] failed to ensure tables:', e === null || e === void 0 ? void 0 : e.message);
        }
        finally {
            await queryRunner.release();
        }
    }
};
exports.SubscriptionTablesMigration = SubscriptionTablesMigration;
exports.SubscriptionTablesMigration = SubscriptionTablesMigration = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], SubscriptionTablesMigration);
//# sourceMappingURL=migrate-subscription-tables.js.map