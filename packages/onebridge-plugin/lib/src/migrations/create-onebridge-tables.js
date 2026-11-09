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
exports.ONEBRIDGE_TABLE_NAMES = exports.CreateOnebridgeTablesMigration = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
/**
 * 幂等建表（计划书 §10.1 / §10.2）。
 * 纯增量：只建 onebridge_* 新表，不改任何既有表，不 drop / truncate。
 * 生产 DB_SYNC=0 时由本迁移兜底；本地/预发 synchronize=true 时 hasTable 命中即跳过。
 */
/**
 * 时间列类型随驱动切换：sqljs（e2e）只支持 datetime，postgres 没有该类型。
 * 所有时间列对象集中登记，建表前统一改写 type。
 */
const dateTimeColumns = [];
const dateTime = (name, isNullable = true) => {
    const column = { name, type: 'datetime', isNullable };
    dateTimeColumns.push(column);
    return column;
};
const baseDateTime = (name) => {
    const column = dateTime(name, false);
    column.default = 'CURRENT_TIMESTAMP';
    return column;
};
const BASE_COLUMNS = [
    { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
    baseDateTime('createdAt'),
    baseDateTime('updatedAt'),
];
const varchar = (name, length, isNullable = true) => ({
    name,
    type: 'varchar',
    length: `${length}`,
    isNullable,
});
const int = (name, isNullable = true) => ({ name, type: 'int', isNullable });
const text = (name, isNullable = true) => ({ name, type: 'text', isNullable });
const bool = (name, isNullable = false, defaultValue) => (Object.assign({ name, type: 'boolean', isNullable }, (defaultValue ? { default: defaultValue } : {})));
const TABLES = [
    new typeorm_2.Table({
        name: 'onebridge_rfq',
        columns: [
            ...BASE_COLUMNS,
            varchar('code', 32, false),
            varchar('channelToken', 64, false),
            varchar('needType', 16, false),
            varchar('needLabel', 64, false),
            varchar('customerName', 100, false),
            varchar('customerContact', 200, false),
            varchar('locale', 4, false),
            text('item', false),
            varchar('qty', 200),
            varchar('eta', 100),
            text('memo'),
            varchar('stage', 16, false),
            varchar('businessLine', 8),
            varchar('assignedTeam', 64),
            int('customerId'),
            varchar('idempotencyKey', 128),
        ],
        indices: [
            new typeorm_2.TableIndex({ name: 'idx_onebridge_rfq_code', columnNames: ['code'], isUnique: true }),
            new typeorm_2.TableIndex({
                name: 'idx_onebridge_rfq_channel_need_stage',
                columnNames: ['channelToken', 'needType', 'stage'],
            }),
            new typeorm_2.TableIndex({ name: 'idx_onebridge_rfq_customer_created', columnNames: ['customerId', 'createdAt'] }),
            new typeorm_2.TableIndex({
                name: 'idx_onebridge_rfq_idempotency',
                columnNames: ['idempotencyKey'],
                isUnique: true,
            }),
        ],
    }),
    new typeorm_2.Table({
        name: 'onebridge_rfq_quote',
        columns: [
            ...BASE_COLUMNS,
            int('rfqId', false),
            int('amount', false),
            varchar('currency', 4, false),
            dateTime('validUntil'),
            text('note'),
        ],
        indices: [
            new typeorm_2.TableIndex({ name: 'idx_onebridge_quote_rfq', columnNames: ['rfqId'], isUnique: true }),
        ],
    }),
    new typeorm_2.Table({
        name: 'onebridge_rfq_sample',
        columns: [
            ...BASE_COLUMNS,
            int('rfqId', false),
            varchar('status', 32, false),
            varchar('trackingNo', 64),
            dateTime('confirmedAt'),
        ],
        indices: [new typeorm_2.TableIndex({ name: 'idx_onebridge_sample_rfq', columnNames: ['rfqId'], isUnique: true })],
    }),
    new typeorm_2.Table({
        name: 'onebridge_stage_event',
        columns: [
            ...BASE_COLUMNS,
            varchar('ownerType', 8, false),
            varchar('ownerCode', 32, false),
            varchar('stage', 16, false),
            varchar('titleKr', 100, false),
            varchar('titleCn', 100, false),
            text('descKr'),
            text('descCn'),
            varchar('state', 8, false),
            dateTime('occurredAt', false),
            varchar('operator', 64),
            varchar('idempotencyKey', 128),
        ],
        indices: [
            new typeorm_2.TableIndex({
                name: 'idx_onebridge_stage_owner_occurred',
                columnNames: ['ownerType', 'ownerCode', 'occurredAt'],
            }),
            new typeorm_2.TableIndex({
                name: 'idx_onebridge_stage_idempotency',
                columnNames: ['idempotencyKey'],
                isUnique: true,
            }),
        ],
    }),
    new typeorm_2.Table({
        name: 'onebridge_inspection_report',
        columns: [
            ...BASE_COLUMNS,
            varchar('code', 32, false),
            varchar('orderCode', 32),
            varchar('rfqCode', 32),
            varchar('inspector', 64, false),
            dateTime('inspectedAt', false),
            varchar('result', 16, false),
            text('photos'),
            text('notesKr'),
            text('notesCn'),
            bool('passed', false, 'false'),
            dateTime('publishedAt'),
        ],
        indices: [
            new typeorm_2.TableIndex({ name: 'idx_onebridge_inspection_code', columnNames: ['code'], isUnique: true }),
            new typeorm_2.TableIndex({
                name: 'idx_onebridge_inspection_order_published',
                columnNames: ['orderCode', 'publishedAt'],
            }),
        ],
    }),
    new typeorm_2.Table({
        name: 'onebridge_customs_record',
        columns: [
            ...BASE_COLUMNS,
            varchar('orderCode', 32, false),
            varchar('customsStatus', 24, false),
            dateTime('declaredAt'),
            dateTime('clearedAt'),
            varchar('hsCode', 32),
            varchar('declarationNo', 64),
            text('note'),
            text('docs'),
            dateTime('lastSyncedAt'),
            varchar('idempotencyKey', 128),
        ],
        indices: [
            new typeorm_2.TableIndex({
                name: 'idx_onebridge_customs_order',
                columnNames: ['orderCode'],
                isUnique: true,
            }),
            new typeorm_2.TableIndex({
                name: 'idx_onebridge_customs_idempotency',
                columnNames: ['idempotencyKey'],
                isUnique: true,
            }),
        ],
    }),
    new typeorm_2.Table({
        name: 'onebridge_exchange_rate',
        columns: [
            ...BASE_COLUMNS,
            int('baseCny', false),
            int('quoteKrw', false),
            { name: 'rate', type: 'float', isNullable: false },
            dateTime('effectiveAt', false),
            varchar('source', 64),
        ],
        indices: [new typeorm_2.TableIndex({ name: 'idx_onebridge_rate_effective', columnNames: ['effectiveAt'] })],
    }),
    new typeorm_2.Table({
        name: 'onebridge_content_entry',
        columns: [
            ...BASE_COLUMNS,
            varchar('channelToken', 64, false),
            varchar('contentType', 24, false),
            varchar('slug', 128, false),
            varchar('needType', 16),
            varchar('titleKr', 200, false),
            varchar('titleCn', 200),
            varchar('titleEn', 200),
            text('bodyKr'),
            text('bodyCn'),
            text('bodyEn'),
            varchar('who', 200),
            varchar('caseResult', 200),
            varchar('eta', 100),
            varchar('tag', 32),
            varchar('color', 32),
            text('images'),
            text('payload'),
            int('sort', false),
            bool('published', false, 'false'),
            dateTime('publishedAt'),
        ],
        indices: [
            new typeorm_2.TableIndex({
                name: 'idx_onebridge_content_unique',
                columnNames: ['channelToken', 'contentType', 'slug'],
                isUnique: true,
            }),
            new typeorm_2.TableIndex({
                name: 'idx_onebridge_content_type_sort',
                columnNames: ['channelToken', 'contentType', 'sort'],
            }),
        ],
    }),
];
let CreateOnebridgeTablesMigration = class CreateOnebridgeTablesMigration {
    constructor(connection) {
        this.connection = connection;
    }
    async onApplicationBootstrap() {
        try {
            const dbType = this.connection.options.type;
            const dateTimeType = dbType === 'postgres' ? 'timestamp with time zone' : 'datetime';
            for (const column of dateTimeColumns) {
                column.type = dateTimeType;
            }
            const queryRunner = this.connection.createQueryRunner();
            try {
                for (const table of TABLES) {
                    if (!(await queryRunner.hasTable(table.name))) {
                        await queryRunner.createTable(table, true);
                    }
                }
            }
            finally {
                await queryRunner.release();
            }
        }
        catch (e) {
            // 建表失败不阻塞启动，等待下次启动重试（与 bill-pay-plugin 策略一致）
            // eslint-disable-next-line no-console
            console.error('[CreateOnebridgeTablesMigration] failed to ensure tables:', e === null || e === void 0 ? void 0 : e.message);
        }
    }
};
exports.CreateOnebridgeTablesMigration = CreateOnebridgeTablesMigration;
exports.CreateOnebridgeTablesMigration = CreateOnebridgeTablesMigration = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [typeorm_2.Connection])
], CreateOnebridgeTablesMigration);
exports.ONEBRIDGE_TABLE_NAMES = TABLES.map(t => t.name);
//# sourceMappingURL=create-onebridge-tables.js.map