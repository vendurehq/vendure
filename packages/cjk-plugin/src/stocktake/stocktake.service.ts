/**
 * 盘库 Service（规格 §5/§6/§7 后端实现）。
 * - 建任务：一个事务内固化应盘清单（规格 §6.1）
 * - 盘次独占：同一盘次同一时刻仅一个负责人（规格 §3.6）
 * - 批量录入 / 提交 / 取消：状态按纯函数派生，终态不回退
 * 渠道收口：所有自建表查询一律按 String(ctx.channelId) 过滤（硬性 R10）。
 */
import {
    Administrator,
    Channel,
    ID,
    Logger,
    Product,
    ProductVariant,
    RequestContext,
    StockLevel,
    StockLocation,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';

import { StocktakeLine } from './stocktake-line.entity';
import { StocktakeTask, StocktakeTaskState } from './stocktake-task.entity';
import { StocktakeWave } from './stocktake-wave.entity';
import { StorageBin } from '../storage/storage-bin.entity';
import { StorageZone } from '../storage/storage-zone.entity';
import { VariantStorageBin } from '../storage/variant-storage-bin.entity';
import { TenantMember } from '../tenant/tenant-member.entity';
import {
    aggregateByBin,
    aggregateByCounter,
    buildExpected,
    buildPostItems,
    canTaskTransition,
    canWaveTransition,
    formatTaskCode,
    nextTaskSeq,
    parseStateFilter,
    progressWaves,
    resolveTaskStateAfterWaves,
    resolveScanCode,
    resolveWaveStateAfterCount,
    summarizeVariance,
    toCsv,
    CSV_MAX_ROWS,
    type BindRow,
    type BookRow,
    type CsvCell,
    type ScanLine,
    type StatLine,
    type StocktakeScope,
    type VarianceInputLine,
    waveOwnerError,
} from './stocktake-math';
import { StockDocService } from '../inventory/stock-doc.service';
import { VirtualPhysicalStockService } from '../inventory/virtual-physical-stock.service';

export interface StocktakeOperator { id: string | null; name: string | null; }

/** 看板「盘库次数 / 差异率」计入的任务状态：COUNTED = 全部盘次已提交待过账，POSTED = 已过账。
 *  注：任务状态枚举里**没有** SUBMITTED（那是盘次状态），旧前端把盘次状态误当任务状态用，
 *  导致「待过账（COUNTED）」的任务一直没被计入，D48 一并纠正。 */
const DONE_TASK_STATES: StocktakeTaskState[] = ['COUNTED', 'POSTED'];

/** 'YYYY-MM-DD'（本地时区，与前端 ops-report.ymd 同口径） */
function dayKey(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseIsoDate(value?: string | null): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

export interface StocktakeKpiDay {
    day: string;
    expected: number;
    diff: number;
}

export interface StocktakeKpi {
    /** 窗口内「已提交/已过账」任务数 */
    taskCount: number;
    /** 窗口内应盘行合计 */
    expectedTotal: number;
    /** 窗口内差异变体数合计（|差异|，与差异率分子同源） */
    diffTotal: number;
    /** 窗口内每一天一行（无数据日为 0），与前端差异趋势同口径 */
    days: StocktakeKpiDay[];
}

export interface StocktakeTaskView {
    id: number; code: string; stockLocationId: number; locationName: string | null;
    activityCode: string | null; name: string; scopeJson: string; binModeAtCreate: string;
    state: StocktakeTaskState; createdById: string | null; createdByName: string | null;
    postedStockDocId: number | null; postedAt: Date | null; note: string | null;
    createdAt: Date; expectedTotal: number; countedTotal: number;
    waveCount: number; submittedWaveCount: number;
}

@Injectable()
export class StocktakeService {
    constructor(
        private connection: TransactionalConnection,
        private stockDocService: StockDocService,
        private virtualPhysicalStockService: VirtualPhysicalStockService,
    ) {}

    private get repo() {
        return this.connection.rawConnection.getRepository(StocktakeTask);
    }

    /** 渠道收口键（硬性 R10）：与既有 storage-bin.service.ts 的 tenantOf 同源 */
    private tenantOf(ctx: RequestContext): string {
        return String(ctx.channelId);
    }

    /** 当前操作人：优先 TenantMember.displayName，回退 Administrator 姓名
     *  （D45 修正键错位：ctx.activeUserId 是 User.id，而 TenantMember.administratorId 存的是
     *    Administrator.id —— 必须先经 Administrator.userId 换键，与 tenant-member.service.memberToView
     *    的 canonical 写法同源；否则 Administrator.id ≠ User.id 的账号恒回 {id:null}，
     *    认领盘次直接报「当前账号不是本店人员」，整条录入→提交→过账链路不可用。） */
    async currentOperator(ctx: RequestContext): Promise<StocktakeOperator> {
        if (!ctx.activeUserId) return { id: null, name: null };
        try {
            const admin = await this.connection.getRepository(ctx, Administrator).findOne({
                where: { user: { id: ctx.activeUserId } } as any,
            });
            if (!admin) return { id: null, name: null };
            // 按本渠道收口：操作人必须是**本店**人员（与 assignWave 的 member.channelId 校验同口径）
            const member = await this.connection.getRepository(ctx, TenantMember).findOne({
                where: { administratorId: String(admin.id), channelId: this.tenantOf(ctx) } as any,
            });
            if (member) return { id: String(member.id), name: member.displayName || null };
            const name = [admin.firstName, admin.lastName].filter(Boolean).join(' ');
            return { id: null, name: name || null };
        } catch (e) {
            Logger.warn(`盘库：解析操作人失败 ${(e as Error).message}`, 'Stocktake');
        }
        return { id: null, name: null };
    }

    // ------------------------------------------------------------ 读

    private async buildTaskView(ctx: RequestContext, task: StocktakeTask): Promise<StocktakeTaskView> {
        const waves = await this.connection.getRepository(ctx, StocktakeWave).find({ where: { taskId: Number(task.id) } });
        const lines = await this.connection.getRepository(ctx, StocktakeLine).find({ where: { taskId: Number(task.id) } });
        // D53 进度口径：任务级「已盘 / 应盘」与「已提交盘次 / 盘次」都只统计**未取消**的盘次
        //（任务自身已取消时保留全部，见 progressWaves 注释）——否则取消一个盘次后，
        // 永远盘不到的那些行仍占着分母，任务哪怕已 COUNTED 也显示不满。
        const liveWaves = progressWaves(waves, task.state);
        const liveWaveIds = new Set(liveWaves.map((w) => Number(w.id)));
        const scopedLines = lines.filter((l) => liveWaveIds.has(Number(l.waveId)));
        let locationName: string | null = null;
        try {
            const loc = await this.connection.getRepository(ctx, StockLocation).findOne({ where: { id: task.stockLocationId as any } });
            locationName = loc?.name ?? null;
        } catch { /* 仓库被删 → 不阻塞列表 */ }
        return {
            id: Number(task.id), code: task.code, stockLocationId: task.stockLocationId, locationName,
            activityCode: task.activityCode, name: task.name, scopeJson: task.scopeJson,
            binModeAtCreate: task.binModeAtCreate, state: task.state,
            createdById: task.createdById, createdByName: task.createdByName,
            postedStockDocId: task.postedStockDocId, postedAt: task.postedAt, note: task.note,
            createdAt: task.createdAt,
            expectedTotal: scopedLines.filter((l) => !l.isExtra).length,
            countedTotal: scopedLines.filter((l) => !l.isExtra && l.countedQty !== null).length,
            waveCount: liveWaves.length,
            submittedWaveCount: liveWaves.filter((w) => w.state === 'SUBMITTED').length,
        };
    }

    async listTasks(ctx: RequestContext, options?: any): Promise<{ totalItems: number; items: StocktakeTaskView[] }> {
        const where: any = { tenantChannelId: this.tenantOf(ctx) };
        // 规格 §3.1：state 单值优先，其次 states 多值（In），两者皆空则不过滤。
        // 「已结束」页签必须走多值，否则前端本地过滤 + 分页会串页（第 2 页看起来缺人）。
        const stateFilter = parseStateFilter(options);
        if (stateFilter.mode === 'one') where.state = stateFilter.values[0];
        else if (stateFilter.mode === 'many') where.state = In(stateFilter.values);
        if (options?.activityCode) where.activityCode = options.activityCode;
        if (options?.stockLocationId) where.stockLocationId = Number(options.stockLocationId);
        const page = Number(options?.page) > 0 ? Number(options.page) : 1;
        const pageSize = Math.min(Number(options?.pageSize) > 0 ? Number(options.pageSize) : 20, 100);
        const [tasks, totalItems] = await this.connection.getRepository(ctx, StocktakeTask).findAndCount({
            where, order: { id: 'DESC' }, skip: (page - 1) * pageSize, take: pageSize,
        });
        const items: StocktakeTaskView[] = [];
        for (const t of tasks) items.push(await this.buildTaskView(ctx, t));
        return { totalItems, items };
    }

    async getTask(ctx: RequestContext, id: ID): Promise<StocktakeTaskView | null> {
        const task = await this.assertTask(ctx, id, { allowPosted: true });
        return this.buildTaskView(ctx, task);
    }

    /**
     * 看板盘库 KPI 聚合（D48）：窗口内「已提交/已过账」任务数 + 差异合计 + 按日差异趋势。
     * 为什么放在服务端：旧前端取 `stocktakeTasks({ pageSize: 100 })`（`listTasks` 把 pageSize 硬顶 100）
     * 再在浏览器内按窗口过滤并逐任务取 `stocktakeDiff` → 窗口内任务超过 100 条时，按 id DESC 截掉的都是
     * **较老**任务，「盘库次数 / 差异率 / 差异趋势」三项同源同步失真。这里由服务端先按 createdAt 判定
     * 窗口内任务（无上限），再聚合，且只发 1 次请求（差异仍复用 diffOf，保证与任务详情页同源同值）。
     * days 覆盖窗口内每一天（无数据日为 0），与前端原 `varianceTrend` 口径逐字对齐；无区间时只返回有数据的日。
     */
    async kpiOf(ctx: RequestContext, options?: { from?: string; to?: string }): Promise<StocktakeKpi> {
        const from = parseIsoDate(options?.from);
        const to = parseIsoDate(options?.to);
        const qb = this.connection
            .getRepository(ctx, StocktakeTask)
            .createQueryBuilder('t')
            .where('t.tenantChannelId = :ch', { ch: this.tenantOf(ctx) })
            .andWhere('t.state IN (:...states)', { states: DONE_TASK_STATES });
        if (from) qb.andWhere('t.createdAt >= :from', { from });
        if (to) qb.andWhere('t.createdAt <= :to', { to });
        const tasks = await qb.orderBy('t.id', 'ASC').getMany();

        let expectedTotal = 0;
        let diffTotal = 0;
        const byDay = new Map<string, StocktakeKpiDay>();
        for (const task of tasks) {
            const d = await this.diffOf(ctx, task.id);
            const expected = d.summary.expectedTotal;
            const diff = d.summary.byVariant.filter((v) => v.diff !== 0).length;
            expectedTotal += expected;
            diffTotal += diff;
            const key = dayKey(task.createdAt);
            const cell = byDay.get(key) ?? { day: key, expected: 0, diff: 0 };
            cell.expected += expected;
            cell.diff += diff;
            byDay.set(key, cell);
        }

        const days: StocktakeKpiDay[] = [];
        if (from && to) {
            const cur = new Date(from);
            cur.setHours(0, 0, 0, 0);
            const end = new Date(to);
            end.setHours(0, 0, 0, 0);
            while (cur.getTime() <= end.getTime()) {
                const key = dayKey(cur);
                days.push(byDay.get(key) ?? { day: key, expected: 0, diff: 0 });
                cur.setDate(cur.getDate() + 1);
            }
        } else {
            days.push(...[...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)));
        }
        return { taskCount: tasks.length, expectedTotal, diffTotal, days };
    }

    async listWaves(ctx: RequestContext, taskId: ID): Promise<StocktakeWave[]> {
        await this.assertTask(ctx, taskId, { allowPosted: true });
        return this.connection.getRepository(ctx, StocktakeWave).find({
            where: { taskId: Number(taskId) }, order: { id: 'ASC' },
        });
    }

    /** 任务取回 + 渠道收口 + 状态校验（所有写路径共用；越权一律 UserInputError） */
    private async assertTask(ctx: RequestContext, id: ID, opts?: { allowPosted?: boolean }): Promise<StocktakeTask> {
        const task = await this.connection.getRepository(ctx, StocktakeTask).findOne({ where: { id: Number(id) } });
        if (!task) throw new UserInputError(`盘点任务 #${id} 不存在`);
        if (task.tenantChannelId !== this.tenantOf(ctx)) throw new UserInputError(`盘点任务 #${id} 不属于当前店铺`);
        if (!opts?.allowPosted && task.state === 'POSTED') throw new UserInputError(`任务 ${task.code} 已过账，无法再修改`);
        if (!opts?.allowPosted && task.state === 'CANCELLED') throw new UserInputError(`任务 ${task.code} 已取消`);
        return task;
    }

    private async assertWave(ctx: RequestContext, id: ID, opts?: { allowTerminal?: boolean }): Promise<StocktakeWave> {
        const wave = await this.connection.getRepository(ctx, StocktakeWave).findOne({ where: { id: Number(id) } });
        if (!wave) throw new UserInputError(`盘次 #${id} 不存在`);
        if (wave.tenantChannelId !== this.tenantOf(ctx)) throw new UserInputError(`盘次 #${id} 不属于当前店铺`);
        if (!opts?.allowTerminal && (wave.state === 'SUBMITTED' || wave.state === 'CANCELLED')) {
            throw new UserInputError(`盘次 #${id} 已提交或已取消，无法再修改`);
        }
        return wave;
    }

    // ------------------------------------------------------------ 建任务

    /** scope.categoryIds → variantIds（商品数据不在纯函数里碰） */
    private async resolveScopeVariants(ctx: RequestContext, scope: StocktakeScope): Promise<number[]> {
        const variantIds = new Set<number>((scope.variantIds || []).map(Number));
        const categoryIds = (scope.categoryIds || []).map(Number);
        if (categoryIds.length) {
            const products = await this.connection.getRepository(ctx, Product).find({
                relations: { facetValues: true },
                where: { facetValues: { id: In(categoryIds) } } as any,
            });
            const productIds = products.map((p) => p.id as number);
            if (productIds.length) {
                const variants = await this.connection.getRepository(ctx, ProductVariant).find({
                    where: { productId: In(productIds) } as any,
                });
                for (const v of variants) variantIds.add(v.id as number);
            }
        }
        return Array.from(variantIds);
    }

    /** 任务头落库（草稿与直接创建共用；DRAFT 不物化盘次与应盘行） */
    private async buildTaskHead(
        ctx: RequestContext,
        input: any,
        opts: { binModeAtCreate: string; state: 'DRAFT' | 'OPEN'; scopeJson: string },
    ): Promise<StocktakeTask> {
        const tenant = this.tenantOf(ctx);
        const operator = await this.currentOperator(ctx);
        const codeList = await this.connection.getRepository(ctx, StocktakeTask).find({
            where: { tenantChannelId: tenant }, select: ['code'],
        });
        const seq = nextTaskSeq(codeList.map((t) => t.code), new Date());
        return this.connection.getRepository(ctx, StocktakeTask).save(new StocktakeTask({
            code: formatTaskCode(new Date(), seq), tenantChannelId: tenant,
            stockLocationId: Number(input.stockLocationId),
            activityCode: input.activityCode ? String(input.activityCode).trim() : null,
            name: String(input.name).trim(),
            scopeJson: opts.scopeJson,
            binModeAtCreate: opts.binModeAtCreate,
            state: opts.state,
            createdById: operator.id, createdByName: operator.name,
            note: input.note ?? null,
        }));
    }

    /** 默认档位（渠道 customFields.binMode；缺省 off） */
    private async currentBinMode(ctx: RequestContext): Promise<'off' | 'zone' | 'bin'> {
        const channel = await this.connection.getRepository(ctx, Channel).findOne({ where: { id: ctx.channelId as any } });
        return ((channel?.customFields as any)?.binMode || 'off') as 'off' | 'zone' | 'bin';
    }

    /**
     * 盘点仓「库存模式」守卫（D51 口径；D52 起实现抽到 `VirtualPhysicalStockService`，
     * 与库存单据 STOCKTAKE 分支共用同一份，避免两处口径漂移）：
     * - `physicalStockEnabled = true`：账面权威在物理仓 → 必须选物理仓；
     * - `physicalStockEnabled = false`（纯虚拟库存店）：店内无物理仓，虚拟仓即唯一账面 → 放行。
     *   生产存量 24 个盘点任务全部指向虚拟仓（t1/t2/t3 等开关为 f 的店），一刀切拒虚拟仓会废掉在用处法。
     */
    private async assertStockLocationAllowed(ctx: RequestContext, stockLocationId: number): Promise<void> {
        return this.virtualPhysicalStockService.assertStocktakeLocationAllowed(ctx, stockLocationId);
    }

    /**
     * 物化：解析范围 → 双源合并 → 建盘次与应盘行（规格 §7.2）。
     * 直接创建与「草稿发布」共用；必须在一个事务内调用（txCtx）。
     */
    private async materializeTask(ctx: RequestContext, txCtx: RequestContext, task: StocktakeTask, binMode: 'off' | 'zone' | 'bin'): Promise<void> {
        const tenant = task.tenantChannelId;
        const stockLocationId = Number(task.stockLocationId);
        const raw = JSON.parse(task.scopeJson || '{}');
        const scope: StocktakeScope = {
            zones: (raw.zones || []).map(Number),
            categoryIds: (raw.categoryIds || []).map(Number),
            variantIds: await this.resolveScopeVariants(ctx, {
                zones: [], categoryIds: raw.categoryIds || [], variantIds: raw.variantIds || [], includeZeroBook: false,
            }),
            includeZeroBook: !!raw.includeZeroBook,
        };
        const autoSplitByZone = raw.autoSplitByZone !== false;

        const levels = await this.connection.getRepository(ctx, StockLevel).find({
            where: { stockLocationId: stockLocationId as any },
        });
        const bookRows: BookRow[] = levels.map((l) => ({ variantId: Number(l.productVariantId), quantity: l.stockOnHand }));
        const bindEntities = await this.connection.getRepository(ctx, VariantStorageBin).find({
            where: { tenantChannelId: tenant, stockLocationId },
        });
        const zones = await this.connection.getRepository(ctx, StorageZone).find({
            where: { tenantChannelId: tenant, stockLocationId },
        });
        const bins = await this.connection.getRepository(ctx, StorageBin).find({
            where: { tenantChannelId: tenant, stockLocationId },
        });
        const zoneById = new Map(zones.map((z) => [z.id as number, z]));
        const binById = new Map(bins.map((b) => [b.id as number, b]));
        const bindRows: BindRow[] = bindEntities
            .filter((b) => {
                const z = zoneById.get(Number(b.zoneId));
                return !!z && z.enabled && (!b.binId || !!binById.get(Number(b.binId))?.enabled);
            })
            .map((b) => ({
                variantId: Number(b.variantId),
                zoneId: Number(b.zoneId),
                binId: b.binId ? Number(b.binId) : null,
                zoneCode: zoneById.get(Number(b.zoneId))?.code ?? null,
                binCode: b.binId ? binById.get(Number(b.binId))?.code ?? null : null,
            }));

        const variantIds = Array.from(new Set([...bookRows.map((r) => r.variantId), ...bindRows.map((r) => r.variantId)]));
        const variants = variantIds.length
            ? await this.connection.getRepository(ctx, ProductVariant).find({ where: { id: In(variantIds) } })
            : [];
        const variantMeta = new Map(variants.map((v) => [v.id as number, { sku: v.sku, name: v.name || v.sku }]));
        const zoneMeta = new Map(zones.map((z) => [z.id as number, { code: z.code, name: z.name }]));

        const expected = buildExpected({ binMode, bookRows, bindRows, variantMeta, zoneMeta, scope, autoSplitByZone });
        if (!expected.waves.some((w) => w.expectedCount > 0)) {
            throw new UserInputError('该范围下没有可盘的商品（既无账面也无归位记录），请检查圈选条件或仓库');
        }
        for (let i = 0; i < expected.waves.length; i++) {
            const w = expected.waves[i];
            const wave = await this.connection.getRepository(txCtx, StocktakeWave).save(new StocktakeWave({
                tenantChannelId: tenant, taskId: Number(task.id), scopeType: w.scopeType,
                zoneId: w.zoneId, zoneCode: w.zoneCode, zoneName: w.zoneName,
                state: 'OPEN', expectedCount: w.expectedCount, countedCount: 0,
                assigneeId: null, assigneeName: null, claimedAt: null, submittedAt: null,
            }));
            const rows = expected.linesByWave[i].map((l) => new StocktakeLine({
                tenantChannelId: tenant, taskId: Number(task.id), waveId: Number(wave.id),
                variantId: l.variantId, variantSku: l.variantSku, variantName: l.variantName,
                zoneId: l.zoneId, binId: l.binId, zoneCode: l.zoneCode, binCode: l.binCode,
                bookQty: l.bookQty, countedQty: null, isExtra: false,
            }));
            if (rows.length) await this.connection.getRepository(txCtx, StocktakeLine).save(rows);
        }
    }

    async createTask(ctx: RequestContext, input: any): Promise<StocktakeTaskView> {
        const stockLocationId = Number(input.stockLocationId);
        if (!stockLocationId) throw new UserInputError('请选择盘点仓库');
        await this.assertStockLocationAllowed(ctx, stockLocationId);
        if (!input.name || !String(input.name).trim()) throw new UserInputError('请填写任务名称');
        const state: 'DRAFT' | 'OPEN' = String(input.state || 'OPEN').toUpperCase() === 'DRAFT' ? 'DRAFT' : 'OPEN';
        if (input.state && !['DRAFT', 'OPEN'].includes(String(input.state).toUpperCase())) {
            throw new UserInputError(`任务状态只能是 DRAFT 或 OPEN（收到 ${input.state}）`);
        }

        // SDL 兼容：老前端把拆盘开关传在顶层（不在 scope 内），scope 未带时归并进来，
        // 保持「直接创建」的既有语义（autoSplitByZone=false = 整仓单盘次）。
        const scope: any = { ...(input.scope || {}) };
        if (scope.autoSplitByZone === undefined && input.autoSplitByZone !== undefined) {
            scope.autoSplitByZone = input.autoSplitByZone !== false;
        }
        const scopeJson = JSON.stringify(scope);

        return this.connection.withTransaction(ctx, async (txCtx) => {
            if (state === 'DRAFT') {
                // 草稿只写任务头（规格 §3.2）：不解析 categoryIds → variantIds、不物化；
                // 档位留空串（列非空），发布时按当时渠道档位写入。
                const head = await this.buildTaskHead(txCtx, input, {
                    binModeAtCreate: '', state: 'DRAFT', scopeJson,
                });
                return this.buildTaskView(txCtx, head);
            }
            const binMode = await this.currentBinMode(ctx);
            const head = await this.buildTaskHead(txCtx, input, {
                binModeAtCreate: binMode, state: 'OPEN', scopeJson,
            });
            await this.materializeTask(ctx, txCtx, head, binMode);
            head.state = 'OPEN';
            await this.connection.getRepository(txCtx, StocktakeTask).save(head);
            return this.buildTaskView(txCtx, head);
        });
    }

    /** 草稿发布（规格 §3.2 / §5）：仅 DRAFT 可发；发布时才物化盘次与应盘行 */
    async openTask(ctx: RequestContext, taskId: ID): Promise<StocktakeTaskView> {
        const task = await this.assertTask(ctx, taskId);
        if (task.state !== 'DRAFT') throw new UserInputError(`任务 ${task.code} 已发布（当前状态 ${task.state}），不能重复发布`);
        return this.connection.withTransaction(ctx, async (txCtx) => {
            const binMode = await this.currentBinMode(ctx);
            task.binModeAtCreate = binMode;      // 规格 §3.2：以发布时档位为准
            await this.connection.getRepository(txCtx, StocktakeTask).save(task);
            await this.materializeTask(ctx, txCtx, task, binMode);
            task.state = 'OPEN';
            const saved = await this.connection.getRepository(txCtx, StocktakeTask).save(task);
            return this.buildTaskView(txCtx, saved);
        });
    }

    /** 草稿编辑（规格 §5）：仅 DRAFT 可改；状态不经此路径变更 */
    async updateTask(ctx: RequestContext, taskId: ID, input: any): Promise<StocktakeTaskView> {
        const task = await this.assertTask(ctx, taskId);
        if (task.state !== 'DRAFT') throw new UserInputError(`任务 ${task.code} 已发布，范围不可再改（起草稿后再编辑）`);
        if (input.name !== undefined && input.name !== null) {
            if (!String(input.name).trim()) throw new UserInputError('请填写任务名称');
            task.name = String(input.name).trim();
        }
        if (input.activityCode !== undefined) task.activityCode = input.activityCode ? String(input.activityCode).trim() : null;
        if (input.note !== undefined) task.note = input.note ?? null;
        if (input.stockLocationId !== undefined && input.stockLocationId !== null) {
            const loc = Number(input.stockLocationId);
            if (!loc) throw new UserInputError('盘点仓库不合法');
            await this.assertStockLocationAllowed(ctx, loc);
            task.stockLocationId = loc;
        }
        if (input.scope !== undefined) {
            const scope = { ...(input.scope || {}) };
            if (input.autoSplitByZone !== undefined) (scope as any).autoSplitByZone = input.autoSplitByZone !== false;
            task.scopeJson = JSON.stringify(scope);
        }
        return this.buildTaskView(ctx, await this.connection.getRepository(ctx, StocktakeTask).save(task));
    }

    // ------------------------------------------------------------ 盘次动作

    async addWave(ctx: RequestContext, taskId: ID, input: any): Promise<StocktakeWave> {
        await this.assertTask(ctx, taskId);
        const scopeType = String(input.scopeType || '');
        if (!['zone', 'whole', 'unassigned'].includes(scopeType)) {
            throw new UserInputError('盘次范围类型不合法（zone / whole / unassigned）');
        }
        if (scopeType === 'zone' && !input.zoneId) throw new UserInputError('按库区拆盘次时必须指定库区');
        // 复用建任务时的清单生成口径：把该范围内尚未落入任何盘次的行补进来
        throw new UserInputError('暂不支持手工补盘次：请在建任务时由系统按库区自动拆分（P1 再开放）');
    }

    async assignWave(ctx: RequestContext, waveId: ID, assigneeId?: string | null): Promise<StocktakeWave> {
        const wave = await this.assertWave(ctx, waveId);
        if (wave.state === 'COUNTING' && assigneeId && String(assigneeId) !== String(wave.assigneeId)) {
            throw new UserInputError('该盘次已开始录入，无法改派；请先释放再由新负责人认领');
        }
        if (!assigneeId) return this.releaseWave(ctx, waveId);
        const member = await this.connection.getRepository(ctx, TenantMember).findOne({
            where: { id: Number(assigneeId) } as any,
        });
        if (!member || member.channelId !== this.tenantOf(ctx)) throw new UserInputError('指定的负责人不存在或不属于当前店铺');
        wave.assigneeId = String(member.id);
        wave.assigneeName = member.displayName || null;
        wave.claimedAt = wave.claimedAt ?? new Date();
        if (wave.state === 'OPEN') wave.state = 'CLAIMED';
        this.connection.getRepository(ctx, StocktakeWave).save(wave);
        return wave;
    }

    async claimWave(ctx: RequestContext, waveId: ID): Promise<StocktakeWave> {
        const wave = await this.assertWave(ctx, waveId);
        const operator = await this.currentOperator(ctx);
        if (!operator.id) throw new UserInputError('当前账号不是本店人员，无法认领盘次');
        if (wave.assigneeId) {
            if (String(wave.assigneeId) === String(operator.id)) return wave; // 幂等
            throw new UserInputError(`该盘次已被 ${wave.assigneeName || '其他人员'} 认领`);
        }
        wave.assigneeId = operator.id;
        wave.assigneeName = operator.name;
        wave.claimedAt = new Date();
        if (wave.state === 'OPEN') wave.state = 'CLAIMED';
        return this.connection.getRepository(ctx, StocktakeWave).save(wave);
    }

    async releaseWave(ctx: RequestContext, waveId: ID): Promise<StocktakeWave> {
        const wave = await this.assertWave(ctx, waveId);
        const operator = await this.currentOperator(ctx);
        const err = waveOwnerError(wave.assigneeId, operator.id, wave.assigneeName);
        if (err) throw new UserInputError(err);
        wave.assigneeId = null;
        wave.assigneeName = null;
        wave.claimedAt = null;
        wave.state = 'OPEN';
        return this.connection.getRepository(ctx, StocktakeWave).save(wave);
    }

    async cancelWave(ctx: RequestContext, waveId: ID): Promise<StocktakeWave> {
        const wave = await this.assertWave(ctx, waveId);
        if (!canWaveTransition(wave.state, 'CANCELLED')) throw new UserInputError(`盘次当前状态 ${wave.state} 不可取消`);
        wave.state = 'CANCELLED';
        const saved = await this.connection.getRepository(ctx, StocktakeWave).save(wave);
        await this.syncTaskState(ctx, wave.taskId);
        return saved;
    }

    async cancelTask(ctx: RequestContext, taskId: ID): Promise<StocktakeTaskView> {
        const task = await this.assertTask(ctx, taskId);
        if (!canTaskTransition(task.state, 'CANCELLED')) throw new UserInputError(`任务当前状态 ${task.state} 不可取消`);
        task.state = 'CANCELLED';
        const saved = await this.connection.getRepository(ctx, StocktakeTask).save(task);
        const waves = await this.connection.getRepository(ctx, StocktakeWave).find({ where: { taskId: Number(task.id) } });
        for (const w of waves) {
            if (w.state !== 'SUBMITTED' && w.state !== 'CANCELLED') {
                w.state = 'CANCELLED';
                await this.connection.getRepository(ctx, StocktakeWave).save(w);
            }
        }
        return this.buildTaskView(ctx, saved);
    }

    /** 盘次集合变化后同步任务状态 */
    private async syncTaskState(ctx: RequestContext, taskId: number): Promise<StocktakeTaskState> {
        const task = await this.connection.getRepository(ctx, StocktakeTask).findOne({ where: { id: taskId } });
        if (!task) throw new UserInputError(`盘点任务 #${taskId} 不存在`);
        const waves = await this.connection.getRepository(ctx, StocktakeWave).find({ where: { taskId } });
        const next = resolveTaskStateAfterWaves(task.state, waves);
        if (next !== task.state) {
            task.state = next;
            await this.connection.getRepository(ctx, StocktakeTask).save(task);
        }
        return task.state;
    }

    // ------------------------------------------------------------ 录入

    async saveCounts(ctx: RequestContext, waveId: ID, inputs: any[]): Promise<StocktakeWave> {
        const wave = await this.assertWave(ctx, waveId);
        const operator = await this.currentOperator(ctx);
        const ownerErr = waveOwnerError(wave.assigneeId, operator.id, wave.assigneeName);
        if (ownerErr) throw new UserInputError(ownerErr);
        if (!Array.isArray(inputs) || !inputs.length) throw new UserInputError('请提交至少一行盘点数量');

        const task = await this.assertTask(ctx, wave.taskId);

        return this.connection.withTransaction(ctx, async (txCtx) => {
            const lines = await this.connection.getRepository(txCtx, StocktakeLine).find({ where: { waveId: Number(wave.id) } });
            const byId = new Map(lines.map((l) => [l.id as number, l]));
            const byVariant = new Map<number, StocktakeLine[]>();
            for (const l of lines) {
                const list = byVariant.get(Number(l.variantId)) || [];
                list.push(l);
                byVariant.set(Number(l.variantId), list);
            }

            for (const item of inputs) {
                const qty = Number(item.countedQty);
                if (!Number.isFinite(qty) || qty < 0) throw new UserInputError('盘点数量必须是不小于 0 的整数');
                let target: StocktakeLine | undefined;
                if (item.lineId) {
                    target = byId.get(Number(item.lineId));
                    if (!target) throw new UserInputError(`应盘行 #${item.lineId} 不属于本次盘次`);
                } else if (item.variantId) {
                    // 扫到已在清单内的变体 → 更新原行（规格 §6.2 配套规则：不新建行）
                    const same = byVariant.get(Number(item.variantId)) || [];
                    const binId = item.binId ? Number(item.binId) : null;
                    target = same.find((l) => (l.binId ?? null) === binId) || same[0];
                }
                if (!target) {
                    // 完全清单外 → 建盘盈行（isExtra=true，账面按 0）
                    const variantId = Number(item.variantId);
                    if (!variantId) throw new UserInputError('清单外登记必须提供商品（variantId）');
                    const variant = await this.connection.getRepository(txCtx, ProductVariant).findOne({ where: { id: variantId } });
                    if (!variant) throw new UserInputError(`商品 #${variantId} 不存在`);
                    target = new StocktakeLine({
                        tenantChannelId: this.tenantOf(ctx), taskId: Number(task.id), waveId: Number(wave.id),
                        variantId, variantSku: variant.sku, variantName: variant.name || variant.sku,
                        zoneId: item.zoneId ? Number(item.zoneId) : null, binId: item.binId ? Number(item.binId) : null,
                        zoneCode: null, binCode: null, bookQty: 0, isExtra: true,
                    });
                }
                target.countedQty = Math.floor(qty);
                target.countedById = operator.id;
                target.countedByName = operator.name;
                target.countedAt = new Date();
                if (item.note !== undefined) target.note = item.note ?? null;
                if (item.zoneId) target.zoneId = Number(item.zoneId);
                if (item.binId) target.binId = Number(item.binId);
                await this.connection.getRepository(txCtx, StocktakeLine).save(target);
            }

            const fresh = await this.connection.getRepository(txCtx, StocktakeLine).find({ where: { waveId: Number(wave.id) } });
            wave.countedCount = fresh.filter((l) => l.countedQty !== null).length;
            wave.state = resolveWaveStateAfterCount(wave.state, wave.countedCount);
            await this.connection.getRepository(txCtx, StocktakeWave).save(wave);
            await this.syncTaskState(txCtx, wave.taskId);
            return wave;
        });
    }

    async submitWave(ctx: RequestContext, waveId: ID): Promise<StocktakeWave> {
        const wave = await this.assertWave(ctx, waveId);
        const operator = await this.currentOperator(ctx);
        const ownerErr = waveOwnerError(wave.assigneeId, operator.id, wave.assigneeName);
        if (ownerErr) throw new UserInputError(ownerErr);
        if (!canWaveTransition(wave.state, 'SUBMITTED')) throw new UserInputError(`盘次当前状态 ${wave.state} 不可提交`);
        wave.state = 'SUBMITTED';
        wave.submittedAt = new Date();
        const saved = await this.connection.getRepository(ctx, StocktakeWave).save(wave);
        await this.syncTaskState(ctx, wave.taskId);
        return saved;
    }

    // ------------------------------------------------------------ 统计与导出

    /** 统计输入行投影（纯函数入参，规格 §7.3） */
    private async statLinesOf(ctx: RequestContext, taskId: ID): Promise<StatLine[]> {
        const lines = await this.connection.getRepository(ctx, StocktakeLine).find({ where: { taskId: Number(taskId) } });
        return lines.map((l) => ({
            waveId: Number(l.waveId), zoneId: l.zoneId, zoneCode: l.zoneCode, binId: l.binId, binCode: l.binCode,
            isExtra: l.isExtra, countedQty: l.countedQty, countedById: l.countedById, countedByName: l.countedByName,
            countedAt: l.countedAt,
        }));
    }

    /** 作业量统计（规格 §6.3）：DRAFT / 零行任务返回空结构，不报错 */
    async statsOf(ctx: RequestContext, taskId: ID) {
        await this.assertTask(ctx, taskId, { allowPosted: true });
        const lines = await this.statLinesOf(ctx, taskId);
        return {
            expectedLines: lines.filter((l) => !l.isExtra).length,
            countedLines: lines.filter((l) => l.countedQty !== null).length,
            byBin: aggregateByBin(lines),
            byCounter: aggregateByCounter(lines),
        };
    }

    /**
     * 全量导出（规格 §6.4 / §7.4）：后端只出 CSV（不引 exceljs/xlsx，守部署铁律）。
     * 四个 kind 与前端「当前视图导出」共用同一份列定义；行数超上限即截断并标记。
     */
    async exportOf(ctx: RequestContext, taskId: ID, kind: string) {
        const task = await this.assertTask(ctx, taskId, { allowPosted: true });
        const lines = await this.statLinesOf(ctx, taskId);
        const ALL = ['variance', 'lines', 'by_bin', 'by_counter'];
        if (!ALL.includes(kind)) throw new UserInputError(`不支持的导出类型 ${kind}（可选：${ALL.join(' / ')}）`);

        let header: string[] = [];
        let body: CsvCell[][] = [];

        if (kind === 'lines') {
            header = ['库位编码', '库位', '变体 SKU', '变体名称', '账面数', '实盘数', '是否盘盈', '盘点人', '盘点时间', '备注'];
            const detail = await this.connection.getRepository(ctx, StocktakeLine).find({ where: { taskId: Number(task.id) }, order: { id: 'ASC' } });
            body = detail.map((l) => [
                l.binCode ?? '', l.zoneCode ?? '', l.variantSku, l.variantName, l.bookQty,
                l.countedQty, l.isExtra, l.countedByName ?? '', l.countedAt, l.note ?? '',
            ]);
        } else if (kind === 'by_bin') {
            header = ['库区', '库位', '应盘', '已盘', '未盘', '盘盈'];
            body = aggregateByBin(lines).map((r) => [r.zoneCode ?? '', r.binCode ?? '', r.expectedLines, r.countedLines, r.uncountedLines, r.extraLines]);
        } else if (kind === 'by_counter') {
            header = ['盘点人', '已盘', '盘盈', '涉及盘次', '最后活动时间'];
            body = aggregateByCounter(lines).map((r) => [r.countedByName ?? '', r.countedLines, r.extraLines, r.waveCount, r.lastCountedAt]);
        } else {
            header = ['库位编码', '库位', '变体 SKU', '变体名称', '盘点数', '快照账面', '过账账面', '差异', '盘盈', '账面变动'];
            const d = await this.diffOf(ctx, task.id);
            body = d.rows.map((r) => [
                r.targetBinCode ?? '', r.targetZoneCode ?? '', r.variantSku, r.variantName, r.countedTotal,
                r.snapBookQty, r.currentBookQty, r.diff, r.isExtra, r.snapBookQty !== r.currentBookQty,
            ]);
        }

        const truncated = body.length > CSV_MAX_ROWS;
        const content = toCsv([header, ...body.slice(0, CSV_MAX_ROWS)]);
        // 导出文件名时间戳按平台时区（Asia/Shanghai），不随进程 TZ 漂移
        const w = (new Date());
        const p2 = (n: number) => String(n).padStart(2, '0');
        const stamp = `${w.getFullYear()}${p2(w.getMonth() + 1)}${p2(w.getDate())}${p2(w.getHours())}${p2(w.getMinutes())}`;
        return {
            filename: `stocktake-${task.code}-${kind}-${stamp}.csv`,
            mimeType: 'text/csv;charset=utf-8',
            content,
            totalRows: body.length,
            truncated,
        };
    }

    // ------------------------------------------------------------ 差异与过账

    /** 读当前账面（StockLevel）+ 当前绑定（variant_storage_bin）→ 差异汇总 */
    private async loadCurrentState(ctx: RequestContext, task: StocktakeTask, variantIds: number[]) {
        if (!variantIds.length) return { currentBook: [] as BookRow[], currentBind: [] as BindRow[] };
        const levels = await this.connection.getRepository(ctx, StockLevel).find({
            where: { stockLocationId: task.stockLocationId as any, productVariantId: In(variantIds) } as any,
        });
        const currentBook: BookRow[] = levels.map((l) => ({ variantId: Number(l.productVariantId), quantity: l.stockOnHand }));
        const binds = await this.connection.getRepository(ctx, VariantStorageBin).find({
            where: { tenantChannelId: task.tenantChannelId, stockLocationId: task.stockLocationId, variantId: In(variantIds) } as any,
        });
        const currentBind: BindRow[] = binds.map((b) => ({
            variantId: Number(b.variantId), zoneId: Number(b.zoneId), binId: b.binId ? Number(b.binId) : null,
        }));
        return { currentBook, currentBind };
    }

    async diffOf(ctx: RequestContext, taskId: ID) {
        const task = await this.assertTask(ctx, taskId, { allowPosted: true });
        const lines = await this.connection.getRepository(ctx, StocktakeLine).find({ where: { taskId: Number(task.id) } });
        const variantIds = Array.from(new Set(lines.map((l) => Number(l.variantId))));
        const { currentBook, currentBind } = await this.loadCurrentState(ctx, task, variantIds);
        const input: VarianceInputLine[] = lines.map((l) => ({
            id: l.id as number, variantId: Number(l.variantId), countedQty: l.countedQty,
            isExtra: l.isExtra, bookQty: l.bookQty,
            zoneId: l.zoneId, binId: l.binId,
        }));
        const summary = summarizeVariance(input, currentBook, currentBind);
        // 规格 §7.5/§7.4：差异表与 variance CSV 的「库位编码 / 库位」列需要真实编码。
        // 汇总只带 targetZoneId/targetBinId，这里按 id 反查编码（空集合不发查询）。
        const targetZoneIds = Array.from(new Set(summary.byVariant.map((v) => v.targetZoneId).filter((x): x is number => x !== null)));
        const targetBinIds = Array.from(new Set(summary.byVariant.map((v) => v.targetBinId).filter((x): x is number => x !== null)));
        const zoneCodeById = new Map<number, string>();
        const binCodeById = new Map<number, string>();
        if (targetZoneIds.length) {
            const zs = await this.connection.getRepository(ctx, StorageZone).find({ where: { id: In(targetZoneIds) } as any });
            for (const z of zs) zoneCodeById.set(Number(z.id), z.code);
        }
        if (targetBinIds.length) {
            const bs = await this.connection.getRepository(ctx, StorageBin).find({ where: { id: In(targetBinIds) } as any });
            for (const b of bs) binCodeById.set(Number(b.id), b.code);
        }
        const skuOf = new Map(lines.map((l) => [Number(l.variantId), { sku: l.variantSku, name: l.variantName }]));
        return {
            summary,
            rows: summary.byVariant.map((v) => ({
                variantId: String(v.variantId),
                variantSku: skuOf.get(v.variantId)?.sku ?? `#${v.variantId}`,
                variantName: skuOf.get(v.variantId)?.name ?? '',
                countedTotal: v.countedTotal, bookQty: v.bookQty, diff: v.diff,
                isExtra: v.isExtra, binChanged: v.binChanged,
                targetZoneId: v.targetZoneId === null ? null : String(v.targetZoneId),
                targetBinId: v.targetBinId === null ? null : String(v.targetBinId),
                targetBinCode: v.targetBinId === null ? null : (binCodeById.get(v.targetBinId) ?? null),
                targetZoneCode: v.targetZoneId === null ? null : (zoneCodeById.get(v.targetZoneId) ?? null),
                snapBookQty: v.snapBookQty, currentBookQty: v.bookQty,
            })),
            uncountedLines: lines.filter((l) => !l.isExtra && l.countedQty === null),
            changedVariants: summary.changedVariants.map((c) => ({
                variantId: String(c.variantId),
                variantSku: skuOf.get(c.variantId)?.sku ?? `#${c.variantId}`,
                snapBookQty: c.snapBookQty, currentBookQty: c.currentBookQty,
            })),
        };
    }

    async post(ctx: RequestContext, taskId: ID, confirm?: boolean) {
        const task = await this.assertTask(ctx, taskId, { allowPosted: true });
        if (task.state === 'POSTED') throw new UserInputError(`任务 ${task.code} 已过账，请勿重复操作`);
        if (task.state !== 'COUNTED') throw new UserInputError(`任务当前状态 ${task.state}，需全部盘次提交后才能过账`);

        const waves = await this.connection.getRepository(ctx, StocktakeWave).find({ where: { taskId: Number(task.id) } });
        const pending = waves.filter((w) => w.state !== 'SUBMITTED' && w.state !== 'CANCELLED');
        if (pending.length) {
            throw new UserInputError(`还有 ${pending.length} 个盘次未提交（${pending.map((w) => w.id).join(', ')}），无法过账`);
        }

        const diff = await this.diffOf(ctx, task.id);
        if (diff.summary.uncountedCount > 0 && !confirm) {
            return {
                ok: false, stockDocId: null, diff,
                message: `有 ${diff.summary.uncountedCount} 项未盘，若确认跳过请勾选后重试`,
            };
        }
        if (diff.summary.recheck && !confirm) {
            return {
                ok: false, stockDocId: null, diff,
                message: `盘点期间账面发生变动（${diff.summary.changedVariants.length} 个商品），已按当前账面重算，请确认后继续`,
            };
        }

        const plan = buildPostItems({ summary: diff.summary, stockLocationId: task.stockLocationId });
        if (!plan.items.length) throw new UserInputError('没有需要过账的差异（数量与库位均无变化）');

        return this.connection.withTransaction(ctx, async (txCtx) => {
            const items = plan.items.map((i) => ({
                variantId: String(i.variantId),
                toStockLocationId: String(i.toStockLocationId),
                qty: i.realQty,
                realQty: i.realQty,
                zoneId: i.zoneId === null ? undefined : String(i.zoneId),
                binId: i.binId === null ? undefined : String(i.binId),
            }));
            const doc = await this.stockDocService.create(txCtx, {
                type: 'STOCKTAKE',
                items,
                remark: `盘点任务 ${task.code}`,
            });
            task.state = 'POSTED';
            task.postedStockDocId = Number(doc.id);
            task.postedAt = new Date();
            await this.connection.getRepository(txCtx, StocktakeTask).save(task);
            return { ok: true, stockDocId: String(doc.id), diff, message: `已生成盘点单据 ${task.code}` };
        });
    }

    // ------------------------------------------------------------ 应盘行与扫码

    /** 应盘行分页 + 已盘/未盘/差异/盘盈筛选 */
    async listLines(ctx: RequestContext, args: any): Promise<{ totalItems: number; items: StocktakeLine[] }> {
        const task = await this.assertTask(ctx, args.taskId, { allowPosted: true });
        const where: any = { taskId: Number(task.id) };
        if (args.waveId) where.waveId = Number(args.waveId);
        let lines = await this.connection.getRepository(ctx, StocktakeLine).find({ where, order: { id: 'ASC' } });
        const f = args.filter || {};
        if (f.onlyCounted) lines = lines.filter((l) => l.countedQty !== null);
        if (f.onlyUncounted) lines = lines.filter((l) => !l.isExtra && l.countedQty === null);
        if (f.onlyExtra) lines = lines.filter((l) => l.isExtra);
        if (f.onlyDiff) {
            const diff = await this.diffOf(ctx, task.id);
            const diffIds = new Set(diff.rows.filter((r: any) => r.diff !== 0).map((r: any) => String(r.variantId)));
            lines = lines.filter((l) => diffIds.has(String(l.variantId)));
        }
        const kw = String(args.keyword || '').trim().toLowerCase();
        if (kw) lines = lines.filter((l) => l.variantSku.toLowerCase().includes(kw) || l.variantName.toLowerCase().includes(kw));
        const page = Number(args.page) > 0 ? Number(args.page) : 1;
        const pageSize = Math.min(Number(args.pageSize) > 0 ? Number(args.pageSize) : 50, 200);
        return { totalItems: lines.length, items: lines.slice((page - 1) * pageSize, page * pageSize) };
    }

    /** 扫码解析：库位码 / 任务内应盘行 / 清单外变体（规格 §7/§8.3） */
    async resolveCode(ctx: RequestContext, taskId: ID, code: string) {
        const task = await this.assertTask(ctx, taskId, { allowPosted: true });
        const tenant = task.tenantChannelId;
        const bins = await this.connection.getRepository(ctx, StorageBin).find({
            where: { tenantChannelId: tenant, stockLocationId: task.stockLocationId },
        });
        const lines = await this.connection.getRepository(ctx, StocktakeLine).find({ where: { taskId: Number(task.id) } });
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { id: In(lines.map((l) => Number(l.variantId))) },
        });
        const scanLines: ScanLine[] = lines.map((l) => {
            const v = variants.find((x) => Number(x.id) === Number(l.variantId));
            return {
                lineId: l.id as number, variantId: Number(l.variantId), sku: l.variantSku,
                barcode: ((v?.customFields as any)?.barcode ?? null),
                internalCode: ((v?.customFields as any)?.internalCode ?? null),
            };
        });
        // 第一轮只在「库位码 + 任务内应盘行」里解析（variants 传空），避免把清单内变体误判为盘盈
        const hit = resolveScanCode(String(code || ''), {
            bins: bins.map((b) => ({ binId: b.id as number, binCode: b.code, zoneId: Number(b.zoneId) })),
            lines: scanLines,
            variants: [],
        });
        if (hit.kind !== 'none') {
            const line = hit.kind === 'line' ? lines.find((l) => l.id === hit.lineId) : undefined;
            return {
                kind: hit.kind,
                binId: hit.kind === 'bin' ? String(hit.binId) : null,
                binCode: hit.kind === 'bin' ? hit.binCode : null,
                zoneId: hit.kind === 'bin' ? String(hit.zoneId) : null,
                lineId: hit.kind === 'line' ? String(hit.lineId) : null,
                variantId: line ? String(line.variantId) : null,
                variantSku: line?.variantSku ?? null,
                variantName: line?.variantName ?? null,
                message: null,
            };
        }
        // 清单外：按 SKU / 内部码 / 条形码反查商品（规格 §8.3「CM 时序」）。
        // 取舍（相对计划初稿的 take:5000 拉全表）：改为 3 次带索引的**精确查询**，避免大库全表扫描，
        //   ① sku 精确匹配（Vendure 原生列，唯一索引）
        //   ② customFields.barcode 精确匹配
        //   ③ customFields.internalCode 精确匹配
        // 三次都未命中才判 none；任一命中即取首个结果。注意 ProductVariant 为 Vendure 核心表，
        // 不走自建表的渠道收口（R10），与既有 storage-bin 对变体的处理口径一致。
        const raw = String(code || '').trim();
        let found: ProductVariant | null = null;
        if (raw) {
            const variantRepo = this.connection.getRepository(ctx, ProductVariant);
            found = await variantRepo.findOne({ where: { sku: raw } });
            if (!found) found = await variantRepo.findOne({ where: { customFields: { barcode: raw } } as any });
            if (!found) found = await variantRepo.findOne({ where: { customFields: { internalCode: raw } } as any });
        }
        if (found) {
            return {
                kind: 'extra', binId: null, binCode: null, zoneId: null, lineId: null,
                variantId: String(found.id), variantSku: found.sku, variantName: found.name || found.sku,
                message: '该商品不在应盘清单内，可登记为盘盈',
            };
        }
        return {
            kind: 'none', binId: null, binCode: null, zoneId: null, lineId: null,
            variantId: null, variantSku: null, variantName: null,
            message: '未匹配到商品或库位，请手动输入',
        };
    }
}