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
Object.defineProperty(exports, "__esModule", { value: true });
exports.JianghuService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const constants_1 = require("./constants");
const jianghu_event_entity_1 = require("./jianghu-event.entity");
const jianghu_clue_entity_1 = require("./jianghu-clue.entity");
const jianghu_intel_entity_1 = require("./jianghu-intel.entity");
const jianghu_profile_entity_1 = require("./jianghu-profile.entity");
const jianghu_record_entity_1 = require("./jianghu-record.entity");
const jianghu_risk_service_1 = require("./jianghu-risk.service");
const jianghu_task_entity_1 = require("./jianghu-task.entity");
const platform_time_1 = require("./platform-time");
const options_1 = require("./options");
/** 情报分类中文（实体未存文案，后端按分类派生下发） */
const INTEL_CATEGORY_TEXT = {
    FOOD: '食堂风味',
    CLASSROOM: '空教室',
    CLUB: '社团活动',
    EVENT: '校园活动',
    NOTICE: '通知公告',
    SCENERY: '校园风物',
};
const todayStr = () => (0, platform_time_1.platformDayKey)(new Date());
let JianghuService = class JianghuService {
    constructor(connection, customerService, risk) {
        this.connection = connection;
        this.customerService = customerService;
        this.risk = risk;
    }
    /* ───────────── 基础 ───────────── */
    async requireCustomer(ctx) {
        var _a;
        const userId = ctx.activeUserId;
        if (!userId)
            throw new core_1.UserInputError('请先登录');
        const customer = await this.customerService.findOneByUserId(ctx, userId);
        if (!customer)
            throw new core_1.UserInputError('用户未注册');
        if (((_a = customer.customFields) === null || _a === void 0 ? void 0 : _a.riderStatus) !== 'APPROVED') {
            throw new core_1.UserInputError('尚未成为骑手或审核未通过');
        }
        return customer;
    }
    async getOrCreateProfile(ctx, customer) {
        var _a, _b, _c, _d;
        const repo = this.connection.getRepository(ctx, jianghu_profile_entity_1.JianghuProfile);
        const existing = await repo.findOne({ where: { customerId: customer.id } });
        if (existing)
            return existing;
        return (await repo.save({
            customerId: customer.id,
            nickname: ((_a = customer.customFields) === null || _a === void 0 ? void 0 : _a.jianghuNickname) || '江湖新丁',
            campusCode: (_b = customer.customFields) === null || _b === void 0 ? void 0 : _b.riderCampus,
            credit: (_d = (_c = customer.customFields) === null || _c === void 0 ? void 0 : _c.riderCredit) !== null && _d !== void 0 ? _d : 100,
            rankCode: 'L1',
            repDailyCap: constants_1.REP_DAILY_CAP,
            repDay: todayStr(),
        }));
    }
    profileView(p) {
        return Object.assign(Object.assign({}, p), { rankName: (0, constants_1.computeRank)(p.rep).name });
    }
    taskView(task, me, lat, lng) {
        const v = Object.assign({}, task);
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
        const d = this.risk.distanceKm(lat, lng, task.lat, task.lng);
        if (d != null)
            v.distanceKm = Math.round(d * 100) / 100;
        return v;
    }
    /* ───────────── 读 ───────────── */
    async myProfile(ctx) {
        const c = await this.requireCustomer(ctx);
        return this.profileView(await this.getOrCreateProfile(ctx, c));
    }
    async hall(ctx, type, campusCode, cursor, limit = 20, lat, lng) {
        const repo = this.connection.getRepository(ctx, jianghu_task_entity_1.JianghuTask);
        const qb = repo.createQueryBuilder('t').where('t.status = :s', { s: 'OPEN' });
        if (type)
            qb.andWhere('t.type = :t', { t: type });
        if (campusCode)
            qb.andWhere('t.campusCode = :c', { c: campusCode });
        if (cursor)
            qb.andWhere('t.id < :cursor', { cursor });
        qb.orderBy('t.createdAt', 'DESC').take(limit);
        const list = await qb.getMany();
        const me = ctx.activeUserId ? String(ctx.activeUserId) : undefined;
        return list.map((t) => this.taskView(t, me, lat, lng));
    }
    async taskDetail(ctx, taskId) {
        const repo = this.connection.getRepository(ctx, jianghu_task_entity_1.JianghuTask);
        const t = await repo.findOne({ where: { id: taskId } });
        if (!t)
            return null;
        const me = ctx.activeUserId ? String(ctx.activeUserId) : undefined;
        return this.taskView(t, me);
    }
    async myRecords(ctx, cursor, limit = 20) {
        const c = await this.requireCustomer(ctx);
        const repo = this.connection.getRepository(ctx, jianghu_record_entity_1.JianghuRecord);
        const qb = repo.createQueryBuilder('r').where('r.customerId = :c', { c: c.id });
        if (cursor)
            qb.andWhere('r.id < :cursor', { cursor });
        qb.orderBy('r.createdAt', 'DESC').take(limit);
        return qb.getMany();
    }
    async dailyRank(ctx, campusCode) {
        const repo = this.connection.getRepository(ctx, jianghu_profile_entity_1.JianghuProfile);
        const qb = repo.createQueryBuilder('p');
        if (campusCode)
            qb.where('p.campusCode = :cc', { cc: campusCode });
        else
            qb.where('1 = 1');
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
    async intelMarket(ctx, campusCode, cursor, limit = 20) {
        const repo = this.connection.getRepository(ctx, jianghu_intel_entity_1.JianghuIntel);
        const qb = repo.createQueryBuilder('i').where('i.status = :s', { s: 'APPROVED' });
        if (campusCode)
            qb.andWhere('i.campusCode = :c', { c: campusCode });
        if (cursor)
            qb.andWhere('i.id < :cursor', { cursor });
        qb.orderBy('i.createdAt', 'DESC').take(limit);
        const list = await qb.getMany();
        return list.map((it) => { var _a; return (Object.assign(Object.assign({}, it), { categoryText: (_a = INTEL_CATEGORY_TEXT[it.category]) !== null && _a !== void 0 ? _a : it.category, unlocked: false })); });
    }
    async eventCurrent(ctx, campusCode) {
        const repo = this.connection.getRepository(ctx, jianghu_event_entity_1.JianghuEvent);
        return repo.createQueryBuilder('e').orderBy('e.createdAt', 'DESC').take(1).getOne();
    }
    /** P2 事件详情：拼图进度 + 线索墙 + 贡献者排行 + 我的状态（含破案奖励核算） */
    async eventDetail(ctx, campusCode) {
        var _a;
        const event = await this.eventCurrent(ctx, campusCode);
        if (!event)
            return null;
        const clueRepo = this.connection.getRepository(ctx, jianghu_clue_entity_1.JianghuClue);
        const clues = await clueRepo.find({ where: { eventId: String(event.id) }, order: { createdAt: 'ASC' } });
        // 公共线索墙仅展示已上墙(SHOWN)；PENDING 待审、REJECTED 下线均不对外可见
        const shownClues = clues.filter((c) => c.status === jianghu_clue_entity_1.ClueStatus.SHOWN);
        const me = ctx.activeUserId ? String(ctx.activeUserId) : undefined;
        // 我的线索保留自身全部状态（玩家可见自己提交的待审线索）
        const myClues = me ? clues.filter((c) => String(c.customerId) === me) : [];
        const map = new Map();
        for (const c of shownClues) {
            const k = String(c.customerId);
            if (!map.has(k))
                map.set(k, { count: 0, nickname: c.nickname || '匿名传信者' });
            map.get(k).count += 1;
        }
        const contributorIds = [...map.keys()];
        const contributors = contributorIds
            .map((cid) => ({ customerId: cid, nickname: map.get(cid).nickname, count: map.get(cid).count, isMe: cid === me }))
            .sort((a, b) => b.count - a.count);
        const solved = event.collected >= event.total;
        let myRewardRep;
        let rewarded = false;
        if (solved && me && contributorIds.includes(me) && event.rewardPoolRep) {
            myRewardRep = Math.floor(event.rewardPoolRep / contributorIds.length) || undefined;
            const recRepo = this.connection.getRepository(ctx, jianghu_record_entity_1.JianghuRecord);
            const rec = await recRepo.findOne({
                where: { idempotentKey: `${me}:EVENT:${event.id}:${(_a = ctx.channelId) !== null && _a !== void 0 ? _a : ''}` },
            });
            rewarded = !!rec;
        }
        return Object.assign(Object.assign({}, event), { clues: shownClues, myClues,
            contributors, myContributed: myClues.length, solved,
            myRewardRep,
            rewarded });
    }
    /**
     * 运营后台：列出当前事件的线索（含 PENDING 待审），供审核使用。
     * 玩家侧不可见 PENDING，故此为 admin 专属查询，按创建时间倒序，可按 status 过滤。
     */
    async listClues(ctx, status, limit = 50) {
        const event = await this.eventCurrent(ctx);
        if (!event)
            return [];
        const repo = this.connection.getRepository(ctx, jianghu_clue_entity_1.JianghuClue);
        const where = { eventId: String(event.id) };
        if (status)
            where.status = status;
        return repo.find({ where, order: { createdAt: 'DESC' }, take: limit });
    }
    /** P2 提交线索：点亮一块拼图，集齐后触发破案均分奖励池 */
    async collectClue(ctx, input) {
        var _a;
        const c = await this.requireCustomer(ctx);
        const profile = await this.getOrCreateProfile(ctx, c);
        this.risk.assertNotFrozen(profile, c);
        const content = (input.content || '').trim();
        const sourceNote = (input.sourceNote || '').trim();
        if (!content)
            throw new core_1.UserInputError('线索内容不可为空');
        if (!sourceNote)
            throw new core_1.UserInputError('请填写信息来源（合规留痕）');
        const event = await this.eventCurrent(ctx);
        if (!event)
            throw new core_1.UserInputError('当前无可参与的事件');
        if (event.endAt && new Date(event.endAt).getTime() < Date.now())
            throw new core_1.UserInputError('事件已结束，无法再提交');
        if (event.collected >= event.total)
            throw new core_1.UserInputError('拼图已集齐，静待破案');
        const clueRepo = this.connection.getRepository(ctx, jianghu_clue_entity_1.JianghuClue);
        const myCount = await clueRepo.count({ where: { eventId: String(event.id), customerId: c.id } });
        if (myCount >= event.perPersonLimit) {
            throw new core_1.UserInputError(`单人最多贡献 ${event.perPersonLimit} 条线索`);
        }
        await clueRepo.save({
            eventId: event.id,
            customerId: c.id,
            nickname: profile.nickname,
            content,
            sourceNote,
            campusCode: (_a = c.customFields) === null || _a === void 0 ? void 0 : _a.riderCampus,
            status: jianghu_clue_entity_1.ClueStatus.PENDING,
            likes: 0,
        });
        // 待审门禁：提交即 PENDING，不直接上墙、不计入进度；运营审核通过(SHOWN)才 collected+1。
        // 因此此处不再 event.collected += 1，进度仅由 auditClue(approve=true) 驱动。
        return this.eventDetail(ctx);
    }
    /** 破案结算：奖励池按去重贡献者均分，幂等键防重复发放；贡献者 plotDone+1（对接 L8「组队破大案」） */
    async settleEvent(ctx, event) {
        if (!event.rewardPoolRep)
            return;
        const clueRepo = this.connection.getRepository(ctx, jianghu_clue_entity_1.JianghuClue);
        const clues = await clueRepo.find({ where: { eventId: String(event.id) } });
        // 仅已上墙(SHOWN)的线索计入破案贡献者；PENDING/REJECTED 不计
        const ids = Array.from(new Set(clues.filter((x) => x.status === jianghu_clue_entity_1.ClueStatus.SHOWN).map((x) => Number(x.customerId))));
        if (!ids.length)
            return;
        const per = (0, constants_1.splitRewardPool)(event.rewardPoolRep, ids.length);
        if (per <= 0)
            return;
        for (const cid of ids) {
            const cust = await this.customerService.findOne(ctx, cid);
            if (!cust)
                continue;
            const prof = await this.getOrCreateProfile(ctx, cust);
            prof.plotDone += 1;
            await this.connection.getRepository(ctx, jianghu_profile_entity_1.JianghuProfile).save(prof);
            await this.addRep(ctx, prof, per, 'EVENT', event.id);
        }
    }
    /* ───────────── 运营查询（admin） ───────────── */
    async listProfiles(ctx, cursor, limit = 20) {
        const repo = this.connection.getRepository(ctx, jianghu_profile_entity_1.JianghuProfile);
        const qb = repo.createQueryBuilder('p');
        if (cursor)
            qb.where('p.id < :cursor', { cursor });
        else
            qb.where('1 = 1');
        qb.orderBy('p.rep', 'DESC').take(limit);
        const rows = await qb.getMany();
        return rows.map((r) => this.profileView(r));
    }
    async listTasks(ctx, status, limit = 20) {
        const repo = this.connection.getRepository(ctx, jianghu_task_entity_1.JianghuTask);
        const qb = repo.createQueryBuilder('t');
        if (status)
            qb.where('t.status = :s', { s: status });
        else
            qb.where('1 = 1');
        qb.orderBy('t.createdAt', 'DESC').take(limit);
        const rows = await qb.getMany();
        const me = ctx.activeUserId ? String(ctx.activeUserId) : undefined;
        return rows.map((t) => this.taskView(t, me));
    }
    /* ───────────── 写 ───────────── */
    async take(ctx, taskId) {
        const c = await this.requireCustomer(ctx);
        const profile = await this.getOrCreateProfile(ctx, c);
        this.risk.assertNotFrozen(profile, c);
        const repo = this.connection.getRepository(ctx, jianghu_task_entity_1.JianghuTask);
        const task = await repo.findOne({ where: { id: taskId } });
        if (!task)
            throw new core_1.UserInputError('密信不存在');
        if (task.status !== 'OPEN')
            throw new core_1.UserInputError('密信已被接走');
        if (task.targetCustomerId) {
            const cnt = await this.dailyPairCount(ctx, c.id, task.targetCustomerId);
            if (cnt >= constants_1.DAILY_PAIR_LIMIT) {
                throw new core_1.UserInputError(`同一收信人每日最多 ${constants_1.DAILY_PAIR_LIMIT} 次`);
            }
        }
        const now = Date.now();
        task.status = 'TAKEN';
        task.takenByCustomerId = c.id;
        task.takenAt = new Date(now).toISOString();
        task.expireAt = new Date(now + constants_1.TAKE_LOCK_MS).toISOString();
        task.verifyCode = this.risk.genCode();
        task.codeExpireAt = new Date(now + constants_1.CODE_TTL_MS).toISOString();
        task.tryCount = 0;
        await repo.save(task);
        const me = String(c.id);
        return this.taskView(task, me);
    }
    async release(ctx, taskId) {
        const c = await this.requireCustomer(ctx);
        const repo = this.connection.getRepository(ctx, jianghu_task_entity_1.JianghuTask);
        const task = await repo.findOne({ where: { id: taskId } });
        if (!task)
            return true;
        if (String(task.takenByCustomerId) !== String(c.id))
            throw new core_1.UserInputError('非本人任务');
        task.status = 'OPEN';
        task.takenByCustomerId = null;
        task.takenAt = null;
        task.verifyCode = null;
        task.codeExpireAt = null;
        task.tryCount = 0;
        await repo.save(task);
        // 放弃密信：信用分 -1
        const prepo = this.connection.getRepository(ctx, jianghu_profile_entity_1.JianghuProfile);
        const p = await prepo.findOne({ where: { customerId: c.id } });
        if (p) {
            p.credit = Math.max(0, p.credit - 1);
            await prepo.save(p);
        }
        return true;
    }
    async refreshCode(ctx, taskId) {
        const c = await this.requireCustomer(ctx);
        const repo = this.connection.getRepository(ctx, jianghu_task_entity_1.JianghuTask);
        const task = await repo.findOne({ where: { id: taskId } });
        if (!task)
            throw new core_1.UserInputError('密信不存在');
        if (String(task.takenByCustomerId) !== String(c.id))
            throw new core_1.UserInputError('非本人任务');
        task.verifyCode = this.risk.genCode();
        task.codeExpireAt = new Date(Date.now() + constants_1.CODE_TTL_MS).toISOString();
        await repo.save(task);
        return task.verifyCode;
    }
    async dailyPairCount(ctx, customerId, targetCustomerId) {
        const repo = this.connection.getRepository(ctx, jianghu_task_entity_1.JianghuTask);
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const qb = repo.createQueryBuilder('t');
        qb.where('t.takenByCustomerId = :c', { c: customerId })
            .andWhere('t.targetCustomerId = :t', { t: targetCustomerId })
            .andWhere("t.status = 'VERIFIED'")
            .andWhere('t.takenAt >= :start', { start: start.toISOString() });
        return qb.getCount();
    }
    fail(message, profile) {
        return { ok: false, deltaRep: 0, rep: profile.rep, rankUp: false, message };
    }
    async verify(ctx, taskId, code, lat, lng) {
        var _a, _b, _c;
        const c = await this.requireCustomer(ctx);
        const profile = await this.getOrCreateProfile(ctx, c);
        const repo = this.connection.getRepository(ctx, jianghu_task_entity_1.JianghuTask);
        const task = await repo.findOne({ where: { id: taskId } });
        if (!task)
            return this.fail('密信不存在', profile);
        if (task.status !== 'TAKEN')
            return this.fail('请先接取密信', profile);
        if (String(task.takenByCustomerId) !== String(c.id))
            return this.fail('非本人任务', profile);
        if (task.verifyMode === 'CODE') {
            if (!task.codeExpireAt || Date.now() > new Date(task.codeExpireAt).getTime()) {
                return this.fail('暗号已过期，请刷新', profile);
            }
            task.tryCount = ((_a = task.tryCount) !== null && _a !== void 0 ? _a : 0) + 1;
            if (code !== task.verifyCode) {
                const left = Math.max(0, constants_1.VERIFY_TRY_LIMIT - task.tryCount);
                await repo.save(task);
                if (left <= 0) {
                    task.status = 'REJECTED';
                    await repo.save(task);
                    return this.fail('暗号错误已达上限，密信作废', profile);
                }
                return this.fail(`暗号有误，还可试 ${left} 次`, profile);
            }
        }
        else if (task.verifyMode === 'LBS') {
            if (lat == null || lng == null)
                return this.fail('请开启定位后打卡', profile);
            if (!this.risk.withinFence(lat, lng, (_b = task.lat) !== null && _b !== void 0 ? _b : 0, (_c = task.lng) !== null && _c !== void 0 ? _c : 0, constants_1.LBS_FENCE_M)) {
                return this.fail('未进入收信人所在的楼阁围栏', profile);
            }
        }
        else if (task.verifyMode === 'ORDER_BIND') {
            // 绑定真实订单：由配送域保证送达，此处仅放行
            if (!task.boundOrderId)
                return this.fail('缺少绑定订单', profile);
        }
        // 核销成功
        task.status = 'VERIFIED';
        await repo.save(task);
        const base = task.rewardRep || constants_1.LEVEL_REWARD[task.level];
        const daysSince = Math.floor((Date.now() - (0, platform_time_1.platformWallToInstant)(profile.createdAt).getTime()) / 86400000);
        const mult = (0, constants_1.timeFactor)() * (0, constants_1.streakFactor)(profile.streakDays) * (0, constants_1.rookieFactor)(daysSince);
        const delta = Math.round(base * mult);
        await this.addRep(ctx, profile, delta, 'LETTER_' + task.level, task.id);
        profile.letterDone += 1;
        if (task.level === 'URGENT')
            profile.urgentDone += 1;
        if (task.level === 'SECRET')
            profile.secretDone += 1;
        const nr = (0, constants_1.computeRank)(profile.rep);
        const rankUp = nr.code !== profile.rankCode;
        profile.rankCode = nr.code;
        const prepo = this.connection.getRepository(ctx, jianghu_profile_entity_1.JianghuProfile);
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
    async addRep(ctx, profile, delta, reason, taskId) {
        var _a, _b;
        this.ensureDay(profile);
        let applied = (0, constants_1.clampByDailyCap)(profile.repToday, delta);
        const idem = `${profile.customerId}:${reason}:${taskId !== null && taskId !== void 0 ? taskId : 'x'}:${(_a = ctx.channelId) !== null && _a !== void 0 ? _a : ''}`;
        // 先查幂等：已入账则直接返回，不加声望、不写流水。
        // 关键：不能「先插流水再查旧记录」——Postgres 语句一旦报错，同事务后续查询
        // 全部抛 25P02「当前事务被终止」，幂等恢复代码会失效并把该错误抛给用户。
        const recRepo = this.connection.getRepository(ctx, jianghu_record_entity_1.JianghuRecord);
        const existing = await recRepo.findOne({ where: { idempotentKey: idem } });
        if (existing) {
            return { deltaRep: (_b = existing.deltaRep) !== null && _b !== void 0 ? _b : 0, rep: profile.rep };
        }
        await this.connection.withTransaction(ctx, async (ctx2) => {
            const prepo = this.connection.getRepository(ctx2, jianghu_profile_entity_1.JianghuProfile);
            const p = await prepo.findOneOrFail({ where: { id: profile.id } });
            // 先写流水：撞唯一索引即视为已入账，此时不能也不该再查询（事务已被 PG 中止）
            try {
                await this.connection.getRepository(ctx2, jianghu_record_entity_1.JianghuRecord).save({
                    customerId: profile.customerId,
                    taskId: taskId ? String(taskId) : null,
                    idempotentKey: idem,
                    reason,
                    deltaRep: (0, constants_1.clampByDailyCap)(p.repToday, delta),
                    snapshotRep: p.rep,
                    channelId: ctx2.channelId,
                });
            }
            catch (e) {
                if ((e === null || e === void 0 ? void 0 : e.code) === '23505' || /unique|duplicate/i.test((e === null || e === void 0 ? void 0 : e.message) || '')) {
                    // 并发下已入账：不再查询、不加声望，本次事务整体回滚，保证不重复入账
                    applied = 0;
                    return;
                }
                throw e;
            }
            // 流水落库成功后才加声望
            const left = (0, constants_1.clampByDailyCap)(p.repToday, delta);
            p.repToday += left;
            p.rep += left;
            await prepo.save(p);
            applied = left;
            profile.rep = p.rep;
            profile.repToday = p.repToday;
        });
        return { deltaRep: applied, rep: profile.rep };
    }
    ensureDay(profile) {
        const today = todayStr();
        if (profile.repDay !== today) {
            const yest = (0, platform_time_1.platformDayKey)(new Date(Date.now() - 86400000));
            if (profile.lastActiveDay === yest)
                profile.streakDays += 1;
            else if (profile.lastActiveDay !== today)
                profile.streakDays = 1;
            profile.repToday = 0;
            profile.repDay = today;
            profile.lastActiveDay = today;
        }
    }
    async submitRumor(ctx, input) {
        var _a, _b;
        const c = await this.requireCustomer(ctx);
        if (!((_a = input.sourceNote) === null || _a === void 0 ? void 0 : _a.trim()))
            throw new core_1.UserInputError('请填写信息来源');
        const repo = this.connection.getRepository(ctx, jianghu_intel_entity_1.JianghuIntel);
        const saved = await repo.save({
            category: input.category,
            content: input.content,
            sourceNote: input.sourceNote,
            campusCode: (_b = c.customFields) === null || _b === void 0 ? void 0 : _b.riderCampus,
            summary: input.content.slice(0, 24),
            priceIntel: constants_1.INTEL_PRICE,
            viewCount: 0,
            authorCustomerId: c.id,
            status: 'PENDING',
            channelId: ctx.channelId,
        });
        return { id: saved.id, status: 'PENDING' };
    }
    async unlockIntel(ctx, intelId) {
        var _a;
        const c = await this.requireCustomer(ctx);
        const profile = await this.getOrCreateProfile(ctx, c);
        if (profile.intel < constants_1.INTEL_PRICE)
            throw new core_1.UserInputError('情报值不足');
        const repo = this.connection.getRepository(ctx, jianghu_intel_entity_1.JianghuIntel);
        const it = await repo.findOne({ where: { id: intelId, status: 'APPROVED' } });
        if (!it)
            throw new core_1.UserInputError('情报不存在或未审核');
        profile.intel -= constants_1.INTEL_PRICE;
        it.viewCount += 1;
        const prepo = this.connection.getRepository(ctx, jianghu_profile_entity_1.JianghuProfile);
        await prepo.save(profile);
        await repo.save(it);
        // 作者分成
        if (it.authorCustomerId) {
            const a = await prepo.findOne({ where: { customerId: it.authorCustomerId } });
            if (a) {
                a.rep += constants_1.INTEL_SALE_REWARD;
                await prepo.save(a);
            }
        }
        return Object.assign(Object.assign({}, it), { categoryText: (_a = INTEL_CATEGORY_TEXT[it.category]) !== null && _a !== void 0 ? _a : it.category, unlocked: true });
    }
    /* ───────────── 运营（admin） ───────────── */
    async createTask(ctx, input) {
        var _a, _b;
        const repo = this.connection.getRepository(ctx, jianghu_task_entity_1.JianghuTask);
        const saved = await repo.save(Object.assign(Object.assign({}, input), { brief: (_a = input.brief) !== null && _a !== void 0 ? _a : input.title, rewardRep: (_b = input.rewardRep) !== null && _b !== void 0 ? _b : constants_1.LEVEL_REWARD[input.level], status: 'OPEN', tryCount: 0, channelId: ctx.channelId }));
        return this.taskView(saved);
    }
    async auditIntel(ctx, id, approve) {
        const repo = this.connection.getRepository(ctx, jianghu_intel_entity_1.JianghuIntel);
        const it = await repo.findOne({ where: { id: id } });
        if (!it)
            throw new core_1.UserInputError('情报不存在');
        it.status = approve ? 'APPROVED' : 'REJECTED';
        await repo.save(it);
        if (approve && it.authorCustomerId) {
            const prepo = this.connection.getRepository(ctx, jianghu_profile_entity_1.JianghuProfile);
            const a = await prepo.findOne({ where: { customerId: it.authorCustomerId } });
            if (a) {
                await this.addRep(ctx, a, constants_1.RUMOR_REWARD, 'RUMOR', it.id);
            }
        }
        return it;
    }
    async penalize(ctx, customerId, level) {
        const repo = this.connection.getRepository(ctx, jianghu_profile_entity_1.JianghuProfile);
        let p = await repo.findOne({ where: { customerId: customerId } });
        if (!p) {
            const customer = await this.customerService.findOne(ctx, customerId);
            if (!customer)
                throw new core_1.UserInputError('用户不存在');
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
    async createEvent(ctx, input) {
        var _a, _b, _c, _d;
        const repo = this.connection.getRepository(ctx, jianghu_event_entity_1.JianghuEvent);
        const saved = await repo.save({
            name: input.name,
            desc: input.desc,
            total: (_a = input.total) !== null && _a !== void 0 ? _a : 6,
            perPersonLimit: (_b = input.perPersonLimit) !== null && _b !== void 0 ? _b : 2,
            endAt: (_c = input.endAt) !== null && _c !== void 0 ? _c : null,
            rewardPoolRep: (_d = input.rewardPoolRep) !== null && _d !== void 0 ? _d : null,
            collected: 0,
            channelId: ctx.channelId,
        });
        return saved;
    }
    async auditClue(ctx, id, approve) {
        const repo = this.connection.getRepository(ctx, jianghu_clue_entity_1.JianghuClue);
        const clue = await repo.findOne({ where: { id: id } });
        if (!clue)
            throw new core_1.UserInputError('线索不存在');
        const er = this.connection.getRepository(ctx, jianghu_event_entity_1.JianghuEvent);
        const ev = await er.findOne({ where: { id: clue.eventId } });
        if (approve) {
            // 通过审核：仅当尚未上墙时才计入进度（防止重复计数 / 恢复已上墙线索不重复 +1）
            if (clue.status !== jianghu_clue_entity_1.ClueStatus.SHOWN) {
                clue.status = jianghu_clue_entity_1.ClueStatus.SHOWN;
                if (ev) {
                    ev.collected += 1;
                    await er.save(ev);
                    if (ev.collected >= ev.total) {
                        await this.settleEvent(ctx, ev);
                    }
                }
            }
        }
        else {
            // 下线：已上墙的回收进度；PENDING 直接下线（从未计数，无需回收）
            if (clue.status === jianghu_clue_entity_1.ClueStatus.SHOWN && ev && ev.collected > 0) {
                ev.collected -= 1;
                await er.save(ev);
            }
            clue.status = jianghu_clue_entity_1.ClueStatus.REJECTED;
        }
        await repo.save(clue);
        return clue;
    }
    /**
     * 拉取当前上架的江湖事件文案（Strapi 内容源）。
     * 运营在 h.joho.cn 可视化编辑并上架「江湖事件文案」，此处取 active=true 的那条。
     * 未配置 contentApi 或拉取失败（网络/鉴权）时优雅返回 null，前端回退到实体内联文案。
     */
    async getEventContent(_ctx) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const api = options_1.jianghuOptions.contentApi;
        if (!(api === null || api === void 0 ? void 0 : api.baseUrl))
            return null;
        const collection = (_a = api.collection) !== null && _a !== void 0 ? _a : 'jianghu-event-copies';
        const base = api.baseUrl.replace(/\/+$/, '');
        const url = `${base}/api/${collection}?filters[active][$eq]=true&populate=*`;
        const g = globalThis;
        if (typeof g.fetch !== 'function')
            return null;
        try {
            const res = await g.fetch(url, {
                headers: api.token ? { Authorization: `Bearer ${api.token}` } : {},
            });
            if (!res.ok)
                return null;
            const json = await res.json();
            const raw = (_b = json === null || json === void 0 ? void 0 : json.data) === null || _b === void 0 ? void 0 : _b[0];
            if (!raw)
                return null;
            // Strapi v4 把字段包在 attributes 里；v5 起直接平铺在 document 上。
            // h.joho.cn 已是 v5，这里两种都兼容，避免版本差异导致线上取不到文案。
            const item = (_c = raw.attributes) !== null && _c !== void 0 ? _c : raw;
            const img = (_f = (_e = (_d = item.bannerImage) === null || _d === void 0 ? void 0 : _d.url) !== null && _e !== void 0 ? _e : item.bannerImage) !== null && _f !== void 0 ? _f : null;
            let banner = typeof img === 'string' ? img : null;
            // Strapi 本地上传 provider 存相对路径（/uploads/xx.png），补上基址变成绝对 URL
            if (banner && banner.startsWith('/'))
                banner = base + banner;
            return {
                title: (_g = item.title) !== null && _g !== void 0 ? _g : null,
                desc: (_h = item.desc) !== null && _h !== void 0 ? _h : null,
                bannerImage: banner,
                rewardText: (_j = item.rewardText) !== null && _j !== void 0 ? _j : null,
                active: (_k = item.active) !== null && _k !== void 0 ? _k : true,
            };
        }
        catch (_l) {
            // 文案源不可达：不阻断玩法，回退到实体内联文案
            return null;
        }
    }
};
exports.JianghuService = JianghuService;
exports.JianghuService = JianghuService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.CustomerService,
        jianghu_risk_service_1.JianghuRiskService])
], JianghuService);
//# sourceMappingURL=jianghu.service.js.map