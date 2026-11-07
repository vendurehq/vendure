import { Injectable } from '@nestjs/common';
import {
    Customer,
    CustomerService,
    ID,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import {
    CREDIT_LIMIT,
    INTEL_PRICE,
    INTEL_SALE_REWARD,
    LEVEL_REWARD,
    LBS_FENCE_M,
    CODE_TTL_MS,
    DAILY_PAIR_LIMIT,
    REP_DAILY_CAP,
    RUMOR_REWARD,
    TAKE_LOCK_MS,
    VERIFY_TRY_LIMIT,
    clampByDailyCap,
    computeRank,
    rookieFactor,
    streakFactor,
    splitRewardPool,
    timeFactor,
} from './constants';
import { JianghuEvent } from './jianghu-event.entity';
import { JianghuClue, ClueStatus } from './jianghu-clue.entity';
import { JianghuIntel } from './jianghu-intel.entity';
import { JianghuProfile } from './jianghu-profile.entity';
import { JianghuRecord } from './jianghu-record.entity';
import { JianghuRiskService } from './jianghu-risk.service';
import { JianghuTask } from './jianghu-task.entity';
import { platformDayKey, platformWallToInstant } from './platform-time';
import { jianghuOptions } from './options';

/** 情报分类中文（实体未存文案，后端按分类派生下发） */
const INTEL_CATEGORY_TEXT: Record<string, string> = {
    FOOD: '食堂风味',
    CLASSROOM: '空教室',
    CLUB: '社团活动',
    EVENT: '校园活动',
    NOTICE: '通知公告',
    SCENERY: '校园风物',
};

export interface JianghuVerifyResult {
    ok: boolean;
    deltaRep: number;
    rep: number;
    rankUp: boolean;
    rankCode?: string;
    rankName?: string;
    message?: string;
}

export interface RumorInput {
    category: 'FOOD' | 'CLASSROOM' | 'CLUB' | 'EVENT' | 'NOTICE' | 'SCENERY';
    content: string;
    sourceNote: string;
}

export interface TaskInput {
    type: 'LETTER' | 'INTEL' | 'PLOT';
    level: 'NORMAL' | 'URGENT' | 'SECRET';
    title: string;
    brief?: string;
    plainText?: string;
    campusCode?: string;
    buildingCode?: string;
    targetNick?: string;
    targetBuilding?: string;
    rewardRep?: number;
    verifyMode: 'CODE' | 'QR' | 'LBS' | 'ORDER_BIND';
    boundOrderId?: string;
    lat?: number;
    lng?: number;
}

export interface ClueInput {
    content: string;
    sourceNote: string;
}

export interface EventInput {
    name: string;
    desc: string;
    total?: number;
    perPersonLimit?: number;
    endAt?: string | null;
    rewardPoolRep?: number | null;
}

const todayStr = () => platformDayKey(new Date());

@Injectable()
export class JianghuService {
    constructor(
        private connection: TransactionalConnection,
        private customerService: CustomerService,
        private risk: JianghuRiskService,
    ) {}

    /* ───────────── 基础 ───────────── */

    private async requireCustomer(ctx: RequestContext): Promise<Customer> {
        const userId = ctx.activeUserId;
        if (!userId) throw new UserInputError('请先登录');
        const customer = await this.customerService.findOneByUserId(ctx, userId);
        if (!customer) throw new UserInputError('用户未注册');
        if ((customer.customFields as any)?.riderStatus !== 'APPROVED') {
            throw new UserInputError('尚未成为骑手或审核未通过');
        }
        return customer;
    }

    async getOrCreateProfile(ctx: RequestContext, customer: Customer): Promise<JianghuProfile> {
        const repo = this.connection.getRepository(ctx, JianghuProfile);
        const existing = await repo.findOne({ where: { customerId: customer.id as any } });
        if (existing) return existing;
        return (await repo.save({
            customerId: customer.id as any,
            nickname: (customer.customFields as any)?.jianghuNickname || '江湖新丁',
            campusCode: (customer.customFields as any)?.riderCampus,
            credit: (customer.customFields as any)?.riderCredit ?? 100,
            rankCode: 'L1',
            repDailyCap: REP_DAILY_CAP,
            repDay: todayStr(),
        } as any)) as JianghuProfile;
    }

    private profileView(p: JianghuProfile) {
        return { ...p, rankName: computeRank(p.rep).name };
    }

    private taskView(task: JianghuTask, me?: string, lat?: number, lng?: number) {
        const v: any = { ...task };
        delete v.plainText;
        const mine = task.status === 'TAKEN' && me != null && String(task.takenByCustomerId) === String(me);
        if (!mine) {
            delete v.verifyCode;
            delete v.codeExpireAt;
            delete v.tryCount;
        }
        if (task.expireAt) {
            v.expireInSec = Math.max(0, Math.floor((new Date(task.expireAt).getTime() - Date.now()) / 1000));
        }
        const d = this.risk.distanceKm(lat, lng, (task as any).lat, (task as any).lng);
        if (d != null) v.distanceKm = Math.round(d * 100) / 100;
        return v;
    }

    /* ───────────── 读 ───────────── */

    async myProfile(ctx: RequestContext) {
        const c = await this.requireCustomer(ctx);
        return this.profileView(await this.getOrCreateProfile(ctx, c));
    }

    async hall(ctx: RequestContext, type?: string, campusCode?: string, cursor?: string, limit = 20, lat?: number, lng?: number) {
        const repo = this.connection.getRepository(ctx, JianghuTask);
        const qb = repo.createQueryBuilder('t').where('t.status = :s', { s: 'OPEN' });
        if (type) qb.andWhere('t.type = :t', { t: type });
        if (campusCode) qb.andWhere('t.campusCode = :c', { c: campusCode });
        if (cursor) qb.andWhere('t.id < :cursor', { cursor });
        qb.orderBy('t.createdAt', 'DESC').take(limit);
        const list = await qb.getMany();
        const me = ctx.activeUserId ? String(ctx.activeUserId) : undefined;
        return list.map((t) => this.taskView(t, me, lat, lng));
    }

    async taskDetail(ctx: RequestContext, taskId: string) {
        const repo = this.connection.getRepository(ctx, JianghuTask);
        const t = await repo.findOne({ where: { id: taskId as any } });
        if (!t) return null;
        const me = ctx.activeUserId ? String(ctx.activeUserId) : undefined;
        return this.taskView(t, me);
    }

    async myRecords(ctx: RequestContext, cursor?: string, limit = 20) {
        const c = await this.requireCustomer(ctx);
        const repo = this.connection.getRepository(ctx, JianghuRecord);
        const qb = repo.createQueryBuilder('r').where('r.customerId = :c', { c: c.id });
        if (cursor) qb.andWhere('r.id < :cursor', { cursor });
        qb.orderBy('r.createdAt', 'DESC').take(limit);
        return qb.getMany();
    }

    async dailyRank(ctx: RequestContext, campusCode?: string) {
        const repo = this.connection.getRepository(ctx, JianghuProfile);
        const qb = repo.createQueryBuilder('p');
        if (campusCode) qb.where('p.campusCode = :cc', { cc: campusCode });
        else qb.where('1 = 1');
        qb.orderBy('p.repToday', 'DESC').take(20);
        const rows = await qb.getMany();
        const me = ctx.activeUserId ? String(ctx.activeUserId) : undefined;
        return rows.map((r) => ({
            customerId: String(r.customerId),
            nickname: r.nickname,
            rep: r.repToday,
            isMe: String(r.customerId) === me,
        }));
    }

    async intelMarket(ctx: RequestContext, campusCode?: string, cursor?: string, limit = 20) {
        const repo = this.connection.getRepository(ctx, JianghuIntel);
        const qb = repo.createQueryBuilder('i').where('i.status = :s', { s: 'APPROVED' });
        if (campusCode) qb.andWhere('i.campusCode = :c', { c: campusCode });
        if (cursor) qb.andWhere('i.id < :cursor', { cursor });
        qb.orderBy('i.createdAt', 'DESC').take(limit);
        const list = await qb.getMany();
        return list.map((it) => ({ ...it, categoryText: INTEL_CATEGORY_TEXT[it.category] ?? it.category, unlocked: false }));
    }

    async eventCurrent(ctx: RequestContext, campusCode?: string) {
        const repo = this.connection.getRepository(ctx, JianghuEvent);
        return repo.createQueryBuilder('e').orderBy('e.createdAt', 'DESC').take(1).getOne();
    }

    /** P2 事件详情：拼图进度 + 线索墙 + 贡献者排行 + 我的状态（含破案奖励核算） */
    async eventDetail(ctx: RequestContext, campusCode?: string) {
        const event = await this.eventCurrent(ctx, campusCode);
        if (!event) return null;
        const clueRepo = this.connection.getRepository(ctx, JianghuClue);
        const clues = await clueRepo.find({ where: { eventId: String(event.id) }, order: { createdAt: 'ASC' } });
        // 公共线索墙仅展示已上墙(SHOWN)；PENDING 待审、REJECTED 下线均不对外可见
        const shownClues = clues.filter((c) => c.status === ClueStatus.SHOWN);
        const me = ctx.activeUserId ? String(ctx.activeUserId) : undefined;
        // 我的线索保留自身全部状态（玩家可见自己提交的待审线索）
        const myClues = me ? clues.filter((c) => String(c.customerId) === me) : [];
        const map = new Map<string, { count: number; nickname: string }>();
        for (const c of shownClues) {
            const k = String(c.customerId);
            if (!map.has(k)) map.set(k, { count: 0, nickname: c.nickname || '匿名传信者' });
            map.get(k)!.count += 1;
        }
        const contributorIds = [...map.keys()];
        const contributors = contributorIds
            .map((cid) => ({ customerId: cid, nickname: map.get(cid)!.nickname, count: map.get(cid)!.count, isMe: cid === me }))
            .sort((a, b) => b.count - a.count);
        const solved = event.collected >= event.total;
        let myRewardRep: number | undefined;
        let rewarded = false;
        if (solved && me && contributorIds.includes(me) && event.rewardPoolRep) {
            myRewardRep = Math.floor(event.rewardPoolRep / contributorIds.length) || undefined;
            const recRepo = this.connection.getRepository(ctx, JianghuRecord);
            const rec = await recRepo.findOne({
                where: { idempotentKey: `${me}:EVENT:${event.id}:${ctx.channelId ?? ''}` } as any,
            });
            rewarded = !!rec;
        }
        return {
            ...event,
            clues: shownClues,
            myClues,
            contributors,
            myContributed: myClues.length,
            solved,
            myRewardRep,
            rewarded,
        };
    }

    /**
     * 运营后台：列出当前事件的线索（含 PENDING 待审），供审核使用。
     * 玩家侧不可见 PENDING，故此为 admin 专属查询，按创建时间倒序，可按 status 过滤。
     */
    async listClues(ctx: RequestContext, status?: string, limit = 50) {
        const event = await this.eventCurrent(ctx);
        if (!event) return [];
        const repo = this.connection.getRepository(ctx, JianghuClue);
        const where: any = { eventId: String(event.id) };
        if (status) where.status = status;
        return repo.find({ where, order: { createdAt: 'DESC' }, take: limit });
    }

    /** P2 提交线索：点亮一块拼图，集齐后触发破案均分奖励池 */
    async collectClue(ctx: RequestContext, input: ClueInput) {
        const c = await this.requireCustomer(ctx);
        const profile = await this.getOrCreateProfile(ctx, c);
        this.risk.assertNotFrozen(profile, c);

        const content = (input.content || '').trim();
        const sourceNote = (input.sourceNote || '').trim();
        if (!content) throw new UserInputError('线索内容不可为空');
        if (!sourceNote) throw new UserInputError('请填写信息来源（合规留痕）');

        const event = await this.eventCurrent(ctx);
        if (!event) throw new UserInputError('当前无可参与的事件');
        if (event.endAt && new Date(event.endAt).getTime() < Date.now()) throw new UserInputError('事件已结束，无法再提交');
        if (event.collected >= event.total) throw new UserInputError('拼图已集齐，静待破案');

        const clueRepo = this.connection.getRepository(ctx, JianghuClue);
        const myCount = await clueRepo.count({ where: { eventId: String(event.id), customerId: c.id as any } });
        if (myCount >= event.perPersonLimit) {
            throw new UserInputError(`单人最多贡献 ${event.perPersonLimit} 条线索`);
        }

        await clueRepo.save({
            eventId: event.id,
            customerId: c.id as any,
            nickname: profile.nickname,
            content,
            sourceNote,
            campusCode: (c.customFields as any)?.riderCampus,
            status: ClueStatus.PENDING,
            likes: 0,
        } as any);

        // 待审门禁：提交即 PENDING，不直接上墙、不计入进度；运营审核通过(SHOWN)才 collected+1。
        // 因此此处不再 event.collected += 1，进度仅由 auditClue(approve=true) 驱动。

        return this.eventDetail(ctx);
    }

    /** 破案结算：奖励池按去重贡献者均分，幂等键防重复发放；贡献者 plotDone+1（对接 L8「组队破大案」） */
    private async settleEvent(ctx: RequestContext, event: JianghuEvent) {
        if (!event.rewardPoolRep) return;
        const clueRepo = this.connection.getRepository(ctx, JianghuClue);
        const clues = await clueRepo.find({ where: { eventId: String(event.id) } });
        // 仅已上墙(SHOWN)的线索计入破案贡献者；PENDING/REJECTED 不计
        const ids = Array.from(new Set(clues.filter((x) => x.status === ClueStatus.SHOWN).map((x) => Number(x.customerId))));
        if (!ids.length) return;
        const per = splitRewardPool(event.rewardPoolRep, ids.length);
        if (per <= 0) return;
        for (const cid of ids) {
            const cust = await this.customerService.findOne(ctx, cid as any);
            if (!cust) continue;
            const prof = await this.getOrCreateProfile(ctx, cust);
            prof.plotDone += 1;
            await this.connection.getRepository(ctx, JianghuProfile).save(prof);
            await this.addRep(ctx, prof, per, 'EVENT', event.id as any);
        }
    }

    /* ───────────── 运营查询（admin） ───────────── */

    async listProfiles(ctx: RequestContext, cursor?: string, limit = 20) {
        const repo = this.connection.getRepository(ctx, JianghuProfile);
        const qb = repo.createQueryBuilder('p');
        if (cursor) qb.where('p.id < :cursor', { cursor });
        else qb.where('1 = 1');
        qb.orderBy('p.rep', 'DESC').take(limit);
        const rows = await qb.getMany();
        return rows.map((r) => this.profileView(r));
    }

    async listTasks(ctx: RequestContext, status?: string, limit = 20) {
        const repo = this.connection.getRepository(ctx, JianghuTask);
        const qb = repo.createQueryBuilder('t');
        if (status) qb.where('t.status = :s', { s: status });
        else qb.where('1 = 1');
        qb.orderBy('t.createdAt', 'DESC').take(limit);
        const rows = await qb.getMany();
        const me = ctx.activeUserId ? String(ctx.activeUserId) : undefined;
        return rows.map((t) => this.taskView(t, me));
    }

    /* ───────────── 写 ───────────── */

    async take(ctx: RequestContext, taskId: string) {
        const c = await this.requireCustomer(ctx);
        const profile = await this.getOrCreateProfile(ctx, c);
        this.risk.assertNotFrozen(profile, c);

        const repo = this.connection.getRepository(ctx, JianghuTask);
        const task = await repo.findOne({ where: { id: taskId as any } });
        if (!task) throw new UserInputError('密信不存在');
        if (task.status !== 'OPEN') throw new UserInputError('密信已被接走');

        if (task.targetCustomerId) {
            const cnt = await this.dailyPairCount(ctx, c.id as any, task.targetCustomerId);
            if (cnt >= DAILY_PAIR_LIMIT) {
                throw new UserInputError(`同一收信人每日最多 ${DAILY_PAIR_LIMIT} 次`);
            }
        }

        const now = Date.now();
        task.status = 'TAKEN';
        task.takenByCustomerId = c.id as any;
        task.takenAt = new Date(now).toISOString();
        task.expireAt = new Date(now + TAKE_LOCK_MS).toISOString();
        task.verifyCode = this.risk.genCode();
        task.codeExpireAt = new Date(now + CODE_TTL_MS).toISOString();
        task.tryCount = 0;
        await repo.save(task);

        const me = String(c.id);
        return this.taskView(task, me);
    }

    async release(ctx: RequestContext, taskId: string) {
        const c = await this.requireCustomer(ctx);
        const repo = this.connection.getRepository(ctx, JianghuTask);
        const task = await repo.findOne({ where: { id: taskId as any } });
        if (!task) return true;
        if (String(task.takenByCustomerId) !== String(c.id)) throw new UserInputError('非本人任务');
        task.status = 'OPEN';
        task.takenByCustomerId = null as any;
        task.takenAt = null as any;
        task.verifyCode = null as any;
        task.codeExpireAt = null as any;
        task.tryCount = 0;
        await repo.save(task);

        // 放弃密信：信用分 -1
        const prepo = this.connection.getRepository(ctx, JianghuProfile);
        const p = await prepo.findOne({ where: { customerId: c.id as any } });
        if (p) {
            p.credit = Math.max(0, p.credit - 1);
            await prepo.save(p);
        }
        return true;
    }

    async refreshCode(ctx: RequestContext, taskId: string) {
        const c = await this.requireCustomer(ctx);
        const repo = this.connection.getRepository(ctx, JianghuTask);
        const task = await repo.findOne({ where: { id: taskId as any } });
        if (!task) throw new UserInputError('密信不存在');
        if (String(task.takenByCustomerId) !== String(c.id)) throw new UserInputError('非本人任务');
        task.verifyCode = this.risk.genCode();
        task.codeExpireAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
        await repo.save(task);
        return task.verifyCode!;
    }

    private async dailyPairCount(ctx: RequestContext, customerId: number, targetCustomerId: number) {
        const repo = this.connection.getRepository(ctx, JianghuTask);
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const qb = repo.createQueryBuilder('t');
        qb.where('t.takenByCustomerId = :c', { c: customerId })
            .andWhere('t.targetCustomerId = :t', { t: targetCustomerId })
            .andWhere("t.status = 'VERIFIED'")
            .andWhere('t.takenAt >= :start', { start: start.toISOString() });
        return qb.getCount();
    }

    private fail(message: string, profile: JianghuProfile): JianghuVerifyResult {
        return { ok: false, deltaRep: 0, rep: profile.rep, rankUp: false, message };
    }

    async verify(
        ctx: RequestContext,
        taskId: string,
        code?: string,
        lat?: number,
        lng?: number,
    ): Promise<JianghuVerifyResult> {
        const c = await this.requireCustomer(ctx);
        const profile = await this.getOrCreateProfile(ctx, c);
        const repo = this.connection.getRepository(ctx, JianghuTask);
        const task = await repo.findOne({ where: { id: taskId as any } });
        if (!task) return this.fail('密信不存在', profile);
        if (task.status !== 'TAKEN') return this.fail('请先接取密信', profile);
        if (String(task.takenByCustomerId) !== String(c.id)) return this.fail('非本人任务', profile);

        if (task.verifyMode === 'CODE') {
            if (!task.codeExpireAt || Date.now() > new Date(task.codeExpireAt).getTime()) {
                return this.fail('暗号已过期，请刷新', profile);
            }
            task.tryCount = (task.tryCount ?? 0) + 1;
            if (code !== task.verifyCode) {
                const left = Math.max(0, VERIFY_TRY_LIMIT - task.tryCount);
                await repo.save(task);
                if (left <= 0) {
                    task.status = 'REJECTED';
                    await repo.save(task);
                    return this.fail('暗号错误已达上限，密信作废', profile);
                }
                return this.fail(`暗号有误，还可试 ${left} 次`, profile);
            }
        } else if (task.verifyMode === 'LBS') {
            if (lat == null || lng == null) return this.fail('请开启定位后打卡', profile);
            if (!this.risk.withinFence(lat, lng, task.lat ?? 0, task.lng ?? 0, LBS_FENCE_M)) {
                return this.fail('未进入收信人所在的楼阁围栏', profile);
            }
        } else if (task.verifyMode === 'ORDER_BIND') {
            // 绑定真实订单：由配送域保证送达，此处仅放行
            if (!task.boundOrderId) return this.fail('缺少绑定订单', profile);
        }

        // 核销成功
        task.status = 'VERIFIED';
        await repo.save(task);

        const base = task.rewardRep || LEVEL_REWARD[task.level];
        const daysSince = Math.floor((Date.now() - platformWallToInstant(profile.createdAt).getTime()) / 86400000);
        const mult = timeFactor() * streakFactor(profile.streakDays) * rookieFactor(daysSince);
        const delta = Math.round(base * mult);

        await this.addRep(ctx, profile, delta, 'LETTER_' + task.level, task.id as any);
        profile.letterDone += 1;
        if (task.level === 'URGENT') profile.urgentDone += 1;
        if (task.level === 'SECRET') profile.secretDone += 1;

        const nr = computeRank(profile.rep);
        const rankUp = nr.code !== profile.rankCode;
        profile.rankCode = nr.code;
        const prepo = this.connection.getRepository(ctx, JianghuProfile);
        await prepo.save(profile);

        return {
            ok: true,
            deltaRep: delta,
            rep: profile.rep,
            rankUp,
            rankCode: nr.code,
            rankName: nr.name,
            message: '送达成功',
        };
    }

    /** 声望入账：日上限裁剪 + 事务幂等（唯一键冲突视为已处理） */
    async addRep(
        ctx: RequestContext,
        profile: JianghuProfile,
        delta: number,
        reason: string,
        taskId?: string,
    ): Promise<{ deltaRep: number; rep: number }> {
        this.ensureDay(profile);
        let applied = clampByDailyCap(profile.repToday, delta);
        const idem = `${profile.customerId}:${reason}:${taskId ?? 'x'}:${ctx.channelId ?? ''}`;

        // 先查幂等：已入账则直接返回，不加声望、不写流水。
        // 关键：不能「先插流水再查旧记录」——Postgres 语句一旦报错，同事务后续查询
        // 全部抛 25P02「当前事务被终止」，幂等恢复代码会失效并把该错误抛给用户。
        const recRepo = this.connection.getRepository(ctx, JianghuRecord);
        const existing = await recRepo.findOne({ where: { idempotentKey: idem } as any });
        if (existing) {
            return { deltaRep: existing.deltaRep ?? 0, rep: profile.rep };
        }

        await this.connection.withTransaction(ctx, async (ctx2) => {
            const prepo = this.connection.getRepository(ctx2, JianghuProfile);
            const p = await prepo.findOneOrFail({ where: { id: profile.id } });

            // 先写流水：撞唯一索引即视为已入账，此时不能也不该再查询（事务已被 PG 中止）
            try {
                await this.connection.getRepository(ctx2, JianghuRecord).save({
                    customerId: profile.customerId,
                    taskId: taskId ? String(taskId) : null,
                    idempotentKey: idem,
                    reason,
                    deltaRep: clampByDailyCap(p.repToday, delta),
                    snapshotRep: p.rep,
                    channelId: ctx2.channelId,
                } as any);
            } catch (e: any) {
                if (e?.code === '23505' || /unique|duplicate/i.test(e?.message || '')) {
                    // 并发下已入账：不再查询、不加声望，本次事务整体回滚，保证不重复入账
                    applied = 0;
                    return;
                }
                throw e;
            }

            // 流水落库成功后才加声望
            const left = clampByDailyCap(p.repToday, delta);
            p.repToday += left;
            p.rep += left;
            await prepo.save(p);
            applied = left;
            profile.rep = p.rep;
            profile.repToday = p.repToday;
        });
        return { deltaRep: applied, rep: profile.rep };
    }

    private ensureDay(profile: JianghuProfile) {
        const today = todayStr();
        if (profile.repDay !== today) {
            const yest = platformDayKey(new Date(Date.now() - 86400000));
            if (profile.lastActiveDay === yest) profile.streakDays += 1;
            else if (profile.lastActiveDay !== today) profile.streakDays = 1;
            profile.repToday = 0;
            profile.repDay = today;
            profile.lastActiveDay = today;
        }
    }

    async submitRumor(ctx: RequestContext, input: RumorInput) {
        const c = await this.requireCustomer(ctx);
        if (!input.sourceNote?.trim()) throw new UserInputError('请填写信息来源');
        const repo = this.connection.getRepository(ctx, JianghuIntel);
        const saved = await repo.save({
            category: input.category,
            content: input.content,
            sourceNote: input.sourceNote,
            campusCode: (c.customFields as any)?.riderCampus,
            summary: input.content.slice(0, 24),
            priceIntel: INTEL_PRICE,
            viewCount: 0,
            authorCustomerId: c.id as any,
            status: 'PENDING',
            channelId: ctx.channelId,
        } as any);
        return { id: (saved as any).id, status: 'PENDING' };
    }

    async unlockIntel(ctx: RequestContext, intelId: string) {
        const c = await this.requireCustomer(ctx);
        const profile = await this.getOrCreateProfile(ctx, c);
        if (profile.intel < INTEL_PRICE) throw new UserInputError('情报值不足');

        const repo = this.connection.getRepository(ctx, JianghuIntel);
        const it = await repo.findOne({ where: { id: intelId as any, status: 'APPROVED' } });
        if (!it) throw new UserInputError('情报不存在或未审核');

        profile.intel -= INTEL_PRICE;
        it.viewCount += 1;
        const prepo = this.connection.getRepository(ctx, JianghuProfile);
        await prepo.save(profile);
        await repo.save(it);

        // 作者分成
        if (it.authorCustomerId) {
            const a = await prepo.findOne({ where: { customerId: it.authorCustomerId } });
            if (a) {
                a.rep += INTEL_SALE_REWARD;
                await prepo.save(a);
            }
        }
        return { ...it, categoryText: INTEL_CATEGORY_TEXT[it.category] ?? it.category, unlocked: true };
    }

    /* ───────────── 运营（admin） ───────────── */

    async createTask(ctx: RequestContext, input: TaskInput) {
        const repo = this.connection.getRepository(ctx, JianghuTask);
        const saved = await repo.save({
            ...input,
            brief: input.brief ?? input.title,
            rewardRep: input.rewardRep ?? LEVEL_REWARD[input.level],
            status: 'OPEN',
            tryCount: 0,
            channelId: ctx.channelId,
        } as any);
        return this.taskView(saved as any);
    }

    async auditIntel(ctx: RequestContext, id: string, approve: boolean) {
        const repo = this.connection.getRepository(ctx, JianghuIntel);
        const it = await repo.findOne({ where: { id: id as any } });
        if (!it) throw new UserInputError('情报不存在');
        it.status = approve ? 'APPROVED' : 'REJECTED';
        await repo.save(it);
        if (approve && it.authorCustomerId) {
            const prepo = this.connection.getRepository(ctx, JianghuProfile);
            const a = await prepo.findOne({ where: { customerId: it.authorCustomerId } });
            if (a) {
                await this.addRep(ctx, a, RUMOR_REWARD, 'RUMOR', it.id as any);
            }
        }
        return it;
    }

    async penalize(ctx: RequestContext, customerId: number | string, level: 'WARN' | 'BAN' | 'SEVERE') {
        const repo = this.connection.getRepository(ctx, JianghuProfile);
        let p = await repo.findOne({ where: { customerId: customerId as any } });
        if (!p) {
            const customer = await this.customerService.findOne(ctx, customerId as ID);
            if (!customer) throw new UserInputError('用户不存在');
            p = await this.getOrCreateProfile(ctx, customer);
        }
        const days = level === 'WARN' ? 1 : level === 'BAN' ? 3 : 7;
        p.frozenUntil = new Date(Date.now() + days * 86400000).toISOString();
        p.credit = Math.max(0, p.credit - 10);
        p.violateCount += 1;
        p.rep = Math.max(0, p.rep - 50);
        await repo.save(p);
        return this.profileView(p);
    }

    /* ───────────── 运营（admin）：P2 事件 ───────────── */

    async createEvent(ctx: RequestContext, input: EventInput) {
        const repo = this.connection.getRepository(ctx, JianghuEvent);
        const saved = await repo.save({
            name: input.name,
            desc: input.desc,
            total: input.total ?? 6,
            perPersonLimit: input.perPersonLimit ?? 2,
            endAt: input.endAt ?? null,
            rewardPoolRep: input.rewardPoolRep ?? null,
            collected: 0,
            channelId: ctx.channelId,
        } as any);
        return saved;
    }

    async auditClue(ctx: RequestContext, id: string, approve: boolean) {
        const repo = this.connection.getRepository(ctx, JianghuClue);
        const clue = await repo.findOne({ where: { id: id as any } });
        if (!clue) throw new UserInputError('线索不存在');
        const er = this.connection.getRepository(ctx, JianghuEvent);
        const ev = await er.findOne({ where: { id: clue.eventId as any } });
        if (approve) {
            // 通过审核：仅当尚未上墙时才计入进度（防止重复计数 / 恢复已上墙线索不重复 +1）
            if (clue.status !== ClueStatus.SHOWN) {
                clue.status = ClueStatus.SHOWN;
                if (ev) {
                    ev.collected += 1;
                    await er.save(ev);
                    if (ev.collected >= ev.total) {
                        await this.settleEvent(ctx, ev);
                    }
                }
            }
        } else {
            // 下线：已上墙的回收进度；PENDING 直接下线（从未计数，无需回收）
            if (clue.status === ClueStatus.SHOWN && ev && ev.collected > 0) {
                ev.collected -= 1;
                await er.save(ev);
            }
            clue.status = ClueStatus.REJECTED;
        }
        await repo.save(clue);
        return clue;
    }

    /**
     * 拉取当前上架的江湖事件文案（Strapi 内容源）。
     * 运营在 h.joho.cn 可视化编辑并上架「江湖事件文案」，此处取 active=true 的那条。
     * 未配置 contentApi 或拉取失败（网络/鉴权）时优雅返回 null，前端回退到实体内联文案。
     */
    async getEventContent(_ctx: RequestContext): Promise<JianghuEventContent | null> {
        const api = jianghuOptions.contentApi;
        if (!api?.baseUrl) return null;
        const collection = api.collection ?? 'jianghu-event-copies';
        const base = api.baseUrl.replace(/\/+$/, '');
        const url = `${base}/api/${collection}?filters[active][$eq]=true&populate=*`;
        const g: any = globalThis;
        if (typeof g.fetch !== 'function') return null;
        try {
            const res = await g.fetch(url, {
                headers: api.token ? { Authorization: `Bearer ${api.token}` } : {},
            });
            if (!res.ok) return null;
            const json: any = await res.json();
            const raw: any = json?.data?.[0];
            if (!raw) return null;
            // Strapi v4 把字段包在 attributes 里；v5 起直接平铺在 document 上。
            // h.joho.cn 已是 v5，这里两种都兼容，避免版本差异导致线上取不到文案。
            const item: any = raw.attributes ?? raw;
            const img = item.bannerImage?.url ?? item.bannerImage ?? null;
            let banner: string | null = typeof img === 'string' ? img : null;
            // Strapi 本地上传 provider 存相对路径（/uploads/xx.png），补上基址变成绝对 URL
            if (banner && banner.startsWith('/')) banner = base + banner;
            return {
                title: item.title ?? null,
                desc: item.desc ?? null,
                bannerImage: banner,
                rewardText: item.rewardText ?? null,
                active: item.active ?? true,
            };
        } catch {
            // 文案源不可达：不阻断玩法，回退到实体内联文案
            return null;
        }
    }
}

/** 江湖事件文案（Strapi 内容源）返回结构，与 schema 的 JianghuEventContent 对应 */
export interface JianghuEventContent {
    title: string | null;
    desc: string | null;
    bannerImage: string | null;
    rewardText: string | null;
    active: boolean | null;
}
