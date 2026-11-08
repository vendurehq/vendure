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
var HallService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HallService = exports.ACTIVE_HALL_STATUSES = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const core_2 = require("@vendure/core");
const wechat_subscribe_message_plugin_1 = require("@vendure/wechat-subscribe-message-plugin");
const campus_fulfillment_config_entity_1 = require("./campus-fulfillment-config.entity");
const campus_building_entity_1 = require("./campus-building.entity");
const campus_dedupe_service_1 = require("./campus-dedupe.service");
const capacity_service_1 = require("./capacity.service");
const campus_notify_service_1 = require("./campus-notify.service");
const feishu_notify_service_1 = require("./feishu/feishu-notify.service");
const slot_lock_service_1 = require("./slot-lock.service");
const handover_code_1 = require("./handover-code");
const route_matrix_1 = require("./route-matrix");
/** 仍在履约链路上的大厅状态（取消脱厅/回厅/条件状态迁移共用）。
 * 终态（delivered/cancelled/no_rider_final/exception_final）不在其中，任何写入都不应把终态单改回流转态。 */
exports.ACTIVE_HALL_STATUSES = [
    'open', 'pending_merchant', 'accepted', 'scheduled', 'grabbed', 'third_party',
    'merchant_delivering', 'owned_pool', 'owned_dispatched', 'pending_dispatch',
];
/** customFields 字段名 → 物理列名（Vendure 规则：customFields + 首字母大写 + 其余小写）
 * 例：hallStatus → customFieldsHallstatus；thirdPartyDispatchAt → customFieldsThirdpartydispatchat */
const orderColumn = (field) => `"customFields${field.charAt(0).toUpperCase()}${field.slice(1).toLowerCase()}"`;
/**
 * 入厅服务：跑腿单（orderKind='errand'）或路线 R1/R3 的订单在**支付成功后**自动进入抢单大厅。
 * 含预约时段锁位（T0 前置）：锁位失败标 campusCause='slot_full'，靠调度告警人工跟进。
 * 支付闸门：由插件订阅 PaymentStateTransitionEvent（Authorized/Settled）触发，未支付订单不进大厅、不可被抢。
 */
let HallService = HallService_1 = class HallService {
    constructor(connection, slotLock, moduleRef, capacity, feishu, notify, 
    /** M4 跨实例限频（多实例部署时同单重发不串号）；未注入退回进程内 Map */
    dedupe) {
        this.connection = connection;
        this.slotLock = slotLock;
        this.moduleRef = moduleRef;
        this.capacity = capacity;
        this.feishu = feishu;
        this.notify = notify;
        this.dedupe = dedupe;
        this.handoverResendAt = new Map();
    }
    /** vendure Injector 需由 ModuleRef 构造（Nest 不直接提供 Injector 作为可注入项） */
    get injector() {
        return new core_2.Injector(this.moduleRef);
    }
    /** 收货楼栋坐标（用于挑最近交接点）；楼栋未配坐标返回 null */
    async resolveDestPoint(ctx, order) {
        var _a, _b, _c;
        const cf = order.customFields;
        const buildingId = (_a = cf === null || cf === void 0 ? void 0 : cf.buildingId) !== null && _a !== void 0 ? _a : (_c = (_b = order.shippingAddress) === null || _b === void 0 ? void 0 : _b.customFields) === null || _c === void 0 ? void 0 : _c.buildingId;
        if (!buildingId)
            return null;
        const b = await this.connection
            .getRepository(ctx, campus_building_entity_1.CampusBuilding)
            .findOne({ where: { id: Number(buildingId) } });
        if (!b || b.lat == null || b.lng == null)
            return null;
        return { lat: Number(b.lat), lng: Number(b.lng) };
    }
    /** 预约单时段文本（'2026-10-06 11:00-11:30' 或 '11:00-11:30'）解析时长；无法解析返回 null。
     *  支持跨天时段（如 '23:30-00:10'）：结束时间不大于开始时间时视为次日。 */
    static slotSpanMinutes(text) {
        const m = /(\d{1,2}):(\d{2})\s*[-–~至]\s*(\d{1,2}):(\d{2})/.exec(text);
        if (!m)
            return null;
        const start = Number(m[1]) * 60 + Number(m[2]);
        const end = Number(m[3]) * 60 + Number(m[4]);
        const span = (end <= start ? end + 24 * 60 : end) - start;
        return span > 0 && span <= 12 * 60 ? span : null;
    }
    /**
     * 承诺送达时间（支付时固化，超时赔付判定基准）：
     * - 预约单：时段结束时间（文本解析失败退回「时段开始 + 配送时长」）
     * - 即时单：支付时间 + 店铺配送时长（未配置按 40min）
     */
    resolvePromise(cf, cfg) {
        var _a, _b;
        const minutes = Math.max(10, Number((_a = cfg === null || cfg === void 0 ? void 0 : cfg.deliveryMinutes) !== null && _a !== void 0 ? _a : 40));
        const start = cf.scheduledFor ? new Date(cf.scheduledFor).getTime() : NaN;
        if (!Number.isNaN(start)) {
            const span = HallService_1.slotSpanMinutes(String((_b = cf.deliverySlotText) !== null && _b !== void 0 ? _b : ''));
            return { at: new Date(start + (span !== null && span !== void 0 ? span : minutes) * 60000), source: span ? 'slot' : 'slot_estimate' };
        }
        return { at: new Date(Date.now() + minutes * 60000), source: 'store_minutes' };
    }
    async onOrderPlaced(ctx, orderInput) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        // 支付事件（Authorized → Settled）可能连发两次：以 DB 当前值为准做幂等闸，
        // 事件里的实体快照不含上一次订阅写入的 customFields。
        // 读不到时退回事件实体（正常流程订单必然存在，兜底避免事件对象为空导致漏入厅）。
        // shippingAddress 在本 fork 中被改为 simple-json 列（非 relation），
        // 放进 relations 会抛 EntityPropertyNotFoundError；普通列默认随查询返回，直接读即可。
        const fresh = await this.connection.getRepository(ctx, core_2.Order).findOne({
            where: { id: orderInput.id },
        });
        const order = fresh !== null && fresh !== void 0 ? fresh : orderInput;
        if (order.state === 'Cancelled')
            return;
        const cf = order.customFields;
        if (cf.hallStatus)
            return; // 已入厅（或已挂 scheduled），幂等跳过
        const isErrand = cf.orderKind === 'errand';
        const route = String((_a = cf.fulfillmentRoute) !== null && _a !== void 0 ? _a : (isErrand ? 'R5' : ''));
        // 需要派单的只有 R1/R2/R3；R4 到店自取、R5 跑腿走原链路
        if (!isErrand && !['R1', 'R2', 'R3'].includes(route))
            return;
        const cfg = await this.connection
            .getRepository(ctx, campus_fulfillment_config_entity_1.CampusFulfillmentConfig)
            .findOne({ where: { channelId: ctx.channelId } });
        const plan = (0, route_matrix_1.resolveRoutePlan)(route, cfg !== null && cfg !== void 0 ? cfg : {});
        // R1/R2 恒接力，必须有校园交接点；缺失则降级为传信者到店取餐直送（不能让订单卡住）
        const needsPoint = route === 'R1' || route === 'R2';
        // 多交接点时按收货楼栋坐标取最近；楼栋无坐标退回该路线默认点
        const dest = needsPoint ? await this.resolveDestPoint(ctx, order) : null;
        const point = needsPoint ? (0, route_matrix_1.resolveHandoverPoint)(route, cfg !== null && cfg !== void 0 ? cfg : {}, dest) : null;
        const degrade = needsPoint && !point;
        const promise = this.resolvePromise(cf, cfg);
        // 履约快照：下单时冻结，后续配置变更不影响在途单
        const snapshot = Object.assign({ deliveryPlan: degrade ? 'campus_rider' : ((_b = plan === null || plan === void 0 ? void 0 : plan.leg1) !== null && _b !== void 0 ? _b : 'campus_rider'), handoverMode: degrade ? '' : ((_c = plan === null || plan === void 0 ? void 0 : plan.handover) !== null && _c !== void 0 ? _c : ''), thirdPartyProvider: '', handoverPointName: (_d = point === null || point === void 0 ? void 0 : point.name) !== null && _d !== void 0 ? _d : '', handoverPointAddress: (_e = point === null || point === void 0 ? void 0 : point.address) !== null && _e !== void 0 ? _e : '', handoverPointLat: (_f = point === null || point === void 0 ? void 0 : point.lat) !== null && _f !== void 0 ? _f : null, handoverPointLng: (_g = point === null || point === void 0 ? void 0 : point.lng) !== null && _g !== void 0 ? _g : null, promisedAt: promise.at, promiseSource: promise.source }, (degrade ? { campusCause: 'no_handover_point' } : {}));
        // 降级不能静默（P1）：运费按 R1/R2 收、实际按 campus_rider 直送，必须让运营可见并人工兜底。
        if (degrade) {
            core_2.Logger.error(`Order ${order.code} ${route} degraded to campus_rider: no usable handover point`, 'CampusHall');
            void ((_h = this.feishu) === null || _h === void 0 ? void 0 : _h.pushEvent('alert', '交接点缺失，订单已降级', `订单 ${order.code}（${route}）缺少 ${route} 校园交接点，已降级为传信者到店直送。请补齐交接点配置，并视情况退还运费差价。`, order.code, `degrade:${order.code}`));
        }
        const locked = await this.slotLock.lock(ctx, order);
        const scheduledAt = cf.scheduledFor ? new Date(cf.scheduledFor).getTime() : NaN;
        const deferred = !Number.isNaN(scheduledAt) && scheduledAt - Date.now() > HallService_1.SCHEDULE_RELEASE_MIN * 60000;
        // 入厅条件写（CAS）：仅当 hallStatus 仍为空且订单未取消才写入。
        // 先读后写的无条件 update 会与用户取消并发：取消事件把 hallStatus 置 cancelled 后，
        // 本次写入仍会把已退款单复活成 open/pending_merchant，商家工作台按 hallStatus 查询即会显示已取消单。
        const enter = async (patch) => {
            const entered = await this.transitionFrom(ctx, Number(order.id), [''], Object.assign(Object.assign(Object.assign({}, snapshot), (locked || snapshot.campusCause ? {} : { campusCause: 'slot_full' })), patch));
            if (!entered) {
                // 已取消/已入厅：归还本次可能占用的时段容量，避免取消竞态造成名额泄漏
                await this.slotLock.unlock(ctx, Number(order.id)).catch(() => undefined);
                core_2.Logger.warn(`Order ${order.code} enter hall skipped (cancelled or already entered)`, 'CampusHall');
            }
            return entered;
        };
        // R1：商户/自营快递先完成第一段（送到校园交接点），出餐后由商家工作台分流
        if (route === 'R1' && !degrade) {
            if (deferred) {
                await enter({ hallStatus: 'scheduled' });
                return;
            }
            if (await enter({ hallStatus: 'pending_merchant', hallEnteredAt: new Date() })) {
                core_2.Logger.info(`Order ${order.code} awaiting merchant (R1/${snapshot.deliveryPlan})`, 'CampusHall');
            }
            return;
        }
        // R2：固定外部快递，但必须先经商户接单/出餐（出餐闸门），cookingDone 后才推送外部快递
        if (route === 'R2' && !degrade) {
            const target = deferred ? 'scheduled' : 'pending_merchant';
            if (await enter(Object.assign({ hallStatus: target }, (deferred ? {} : { hallEnteredAt: new Date() })))) {
                core_2.Logger.info(`Order ${order.code} awaiting merchant (R2 cooking gate)`, 'CampusHall');
            }
            return;
        }
        // R3：一段到底，按第一段进入对应池
        const leg1 = String(snapshot.deliveryPlan);
        if (deferred) {
            await enter({ hallStatus: 'scheduled' });
            return;
        }
        if (leg1 === 'external_courier') {
            if (await enter({ hallStatus: 'pending_dispatch', hallEnteredAt: new Date() })) {
                core_2.Logger.info(`Order ${order.code} awaiting external push (R3)`, 'CampusHall');
            }
            return;
        }
        if (leg1 === 'owned') {
            if (await enter({ hallStatus: 'owned_pool', hallEnteredAt: new Date() })) {
                core_2.Logger.info(`Order ${order.code} in owned pool (R3)`, 'CampusHall');
            }
            return;
        }
        if (cfg === null || cfg === void 0 ? void 0 : cfg.merchantConfirmEnabled) {
            await enter({ hallStatus: 'pending_merchant', hallEnteredAt: new Date() });
            return;
        }
        if (!(await enter({ hallStatus: 'open', hallEnteredAt: new Date() })))
            return;
        core_2.Logger.info(`Order ${order.code} entered hall (${route}, slotLocked=${locked})`, 'CampusHall');
        this.notifyRiders(ctx, order);
    }
    /** 预约单放量（调度 job 调用，plan 3.1）：按路由/快照分流。
     * 放量即写 hallEnteredAt 作为「商家/运力计时锚点」：预约单 createdAt 可能早于放量数小时甚至数天，
     * 若下游超时兜底沿用 createdAt，一放量就会被判定超时（R1 直接转自营、R2 直接进大厅、跳过商家确认）。
     * 条件写（仅 scheduled 态）：与用户取消并发时不把已取消单复活。返回是否真正放量。 */
    async releaseScheduled(ctx, order, cfg) {
        const cf = order.customFields;
        const next = HallService_1.releaseTarget(cf, cfg);
        const released = await this.transitionFrom(ctx, Number(order.id), ['scheduled'], {
            hallStatus: next,
            hallEnteredAt: new Date(),
        });
        if (!released) {
            core_2.Logger.info(`Order ${order.code} scheduled release skipped (hall status changed)`, 'CampusHall');
            return false;
        }
        core_2.Logger.info(`Order ${order.code} scheduled → ${next}`, 'CampusHall');
        // 无人接单的渠道保持原行为：放量即提醒在线骑手
        if (next === 'open' || next === 'owned_pool')
            this.notifyRiders(ctx, order);
        return true;
    }
    /** 放量目标态（put 与调度 job 共用；job 用它在内存里同步订单快照，避免同轮二次误判） */
    static releaseTarget(cf, cfg) {
        var _a;
        const route = String((_a = cf.fulfillmentRoute) !== null && _a !== void 0 ? _a : '');
        if (route === 'R1' || route === 'R2')
            return 'pending_merchant'; // 出餐闸门：先等商户接单/出餐
        if (cf.deliveryPlan === 'external_courier')
            return 'pending_dispatch';
        if (cf.deliveryPlan === 'owned')
            return 'owned_pool';
        return (cfg === null || cfg === void 0 ? void 0 : cfg.merchantConfirmEnabled) ? 'pending_merchant' : 'open';
    }
    /** 第一段交接完成：订单进校园抢单大厅（R1/R2 接力上楼）。
     * 条件写（CAS）：仅当 hallStatus 仍在 from 集合内（本段确实在途）才入厅并生成交接码，
     * 否则说明订单已被取消/已入厅（并发回调），返回空串由调用方决定是否报错。
     * extra 承载调用方需要同语句落库的附加字段（如 handoverAt/thirdPartyState），避免两步写。
     * 同时生成 4 位交接码（第二段骑手取货时校验，防丢餐扯皮），返回码值供调用方通知用户。 */
    async enterHallForHandover(ctx, orderId, cause, from = ['third_party', 'merchant_delivering', 'owned_dispatched'], extra = {}) {
        var _a, _b, _c;
        const order = await this.connection.getRepository(ctx, core_2.Order).findOne({
            where: { id: orderId },
            relations: ['channels'],
        });
        if (!order) {
            core_2.Logger.warn(`enterHallForHandover 订单不存在 #${orderId}`, 'CampusHall');
            return '';
        }
        const handoverCode = (0, handover_code_1.generateHandoverCode)();
        const moved = await this.transitionFrom(ctx, orderId, from, Object.assign(Object.assign({}, extra), { hallStatus: 'open', hallEnteredAt: new Date(), deliveryStatus: 'pending', assignedAt: null, deliveryStaffId: null, campusCause: cause, handoverCode, handoverCodeAt: new Date() }));
        if (!moved) {
            core_2.Logger.warn(`订单 ${order.code} 交接入厅被跳过（已取消或状态已变更，from=${from.join('/')}）`, 'CampusHall');
            return '';
        }
        this.notifyRiders(ctx, order);
        // 第一段交接完成：给顾客一个明确节点（餐/包裹已到校园交接点，等待骑手接力）
        const point = String((_b = (_a = order.customFields) === null || _a === void 0 ? void 0 : _a.handoverPointName) !== null && _b !== void 0 ? _b : '校园交接点');
        (_c = this.notify) === null || _c === void 0 ? void 0 : _c.user(ctx, order.id, 'arrivedHandover', point);
        core_2.Logger.info(`订单 ${order.code} 交接完成进入大厅 (${cause})，交接码已生成并脱敏`, 'CampusHall');
        return handoverCode;
    }
    /**
     * R5 交接码重发（飞书指令 / 顾客侧共用）。
     * 条件写（CAS）：仅当 hallStatus='open' 且订单未取消才更新，避免把已完成/已脱厅订单的码改掉。
     * 限流：同单 10 分钟一次；返回新码（调用方自行决定是否展示，日志不落明文）。
     */
    async resendHandoverCode(ctx, orderId) {
        var _a;
        const key = Number(orderId);
        await this.claimResendWindow(key);
        const handoverCode = (0, handover_code_1.generateHandoverCode)();
        const res = await this.connection.rawConnection.query('UPDATE "order" SET "customFieldsHandovercode" = $1, "customFieldsHandovercodeat" = $2 '
            + 'WHERE id = $3 AND "customFieldsHallstatus" = $4 AND "state" <> $5 RETURNING id', [handoverCode, new Date(), key, 'open', 'Cancelled']);
        const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
        if (!Array.isArray(rows) || !rows.length) {
            // 状态不符不占用限流窗口（与原「成功后登记」语义一致）
            await ((_a = this.dedupe) === null || _a === void 0 ? void 0 : _a.del(`handover_resend:${key}`));
            throw new core_2.UserInputError('订单当前不在待交接状态，无法重发交接码');
        }
        this.handoverResendAt.set(key, Date.now());
        core_2.Logger.info(`订单 #${key} 交接码已重发（脱敏）`, 'CampusHall');
        return handoverCode;
    }
    /** 同单 10min 限流：dedupe 走原子计数（跨实例），未注入退回进程内 Map */
    async claimResendWindow(orderId) {
        if (!this.dedupe) {
            const last = this.handoverResendAt.get(orderId);
            if (last != null && Date.now() - last < HallService_1.HANDOVER_RESEND_INTERVAL_MS) {
                throw new core_2.UserInputError('交接码重发过于频繁，请 10 分钟后再试');
            }
            return;
        }
        const n = await this.dedupe.incr(`handover_resend:${orderId}`, HallService_1.HANDOVER_RESEND_INTERVAL_MS);
        if (n > 1)
            throw new core_2.UserInputError('交接码重发过于频繁，请 10 分钟后再试');
    }
    /** R5 顾客侧重发：先校验订单归属当前登录顾客，再复用同一条件写。 */
    async resendHandoverCodeForCustomer(ctx, orderId) {
        var _a, _b;
        if (!ctx.activeUserId)
            throw new core_2.UserInputError('请先登录');
        const order = await this.connection.getRepository(ctx, core_2.Order).findOne({
            where: { id: orderId },
            relations: ['customer', 'customer.user'],
        });
        const ownerUserId = (_b = (_a = order === null || order === void 0 ? void 0 : order.customer) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id;
        if (!order || ownerUserId == null || Number(ownerUserId) !== Number(ctx.activeUserId)) {
            throw new core_2.UserInputError('订单不存在或不属于当前顾客');
        }
        const code = await this.resendHandoverCode(ctx, orderId);
        // G4 审计：顾客自助重发留痕（不记录明文交接码）
        core_2.Logger.info(`顾客重发交接码 order=${orderId} user=${ctx.activeUserId}`, 'CampusHall');
        return code;
    }
    /** 回大厅：清骑手指派字段，hallStatus 复位 open（拒单/超时改派共用）。
     *  条件写：仅活跃流转态可回厅，已取消/已终态单不被复活；extra 与复位字段同语句落库（后台强制回厅留痕）。
     *  返回是否命中。 */
    async backToHall(ctx, orderId, extra) {
        return this.transitionFrom(ctx, orderId, exports.ACTIVE_HALL_STATUSES, Object.assign(Object.assign({}, (extra !== null && extra !== void 0 ? extra : {})), { hallStatus: 'open', deliveryStaffId: null, deliveryStatus: null, assignedAt: null }));
    }
    /**
     * 条件状态迁移（CAS）：仅当 hallStatus 仍在 from 集合内、且订单未被取消时才写入 patch，返回 affected>0。
     * 调度扫描/商家操作都是「先读后写」，若期间用户取消并脱厅（hallStatus=cancelled），
     * 无条件 update 会把已退款单改回 open/pending_merchant 重新进入大厅被抢。
     * 额外加 state != 'Cancelled'：取消事件异步写完 hallStatus 前仍有窗口，仅凭 hallStatus 条件不足。
     * 用单条 UPDATE + 条件把「校验与写入」合并成一个原子动作。
     */
    async transitionFrom(_ctx, orderId, from, patch) {
        const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
        if (!entries.length || !from.length)
            return false;
        const sets = entries.map(([k], i) => `${orderColumn(k)} = $${i + 2}`).join(', ');
        const values = entries.map(([, v]) => (Array.isArray(v) ? JSON.stringify(v) : v));
        const out = await this.connection.rawConnection.query(`UPDATE "order" SET ${sets} `
            + `WHERE id = $1 AND COALESCE("customFieldsHallstatus", '') = ANY($${entries.length + 2}::text[]) `
            + `AND "state" <> 'Cancelled' `
            + 'RETURNING id', [orderId, ...values, from]);
        const rows = Array.isArray(out) && Array.isArray(out[0]) ? out[0] : out;
        return Array.isArray(rows) && rows.length > 0;
    }
    /** 取消脱厅（3.3 冒烟实测缺陷）：订单取消终态时清 hallStatus，使其退出大厅/打包扫描/整组抢单/调度台。
     * 单条条件写：仅活跃流转态可脱厅——先读后写会被 T4 mark() 写 no_rider_final 的竞态覆盖；
     * grabbed 单连带清骑手指派字段（CASE 表达式读同一语句的旧值）。 */
    async exitHall(_ctx, order) {
        const hsCol = orderColumn('hallStatus');
        const clearIfGrabbed = (field) => `${orderColumn(field)} = CASE WHEN ${hsCol} = 'grabbed' THEN NULL ELSE ${orderColumn(field)} END`;
        const out = await this.connection.rawConnection.query(`UPDATE "order" SET ${hsCol} = 'cancelled', `
            + `${clearIfGrabbed('deliveryStaffId')}, ${clearIfGrabbed('deliveryStatus')}, `
            + `${clearIfGrabbed('assignedAt')} `
            + `WHERE id = $1 AND COALESCE(${hsCol}, '') = ANY($2::text[]) RETURNING id`, [order.id, exports.ACTIVE_HALL_STATUSES]);
        const rows = Array.isArray(out) && Array.isArray(out[0]) ? out[0] : out;
        if (!Array.isArray(rows) || !rows.length)
            return;
        core_2.Logger.info(`Order ${order.code} exited hall (→ cancelled)`, 'CampusHall');
    }
    /** 通用订单更新（T4 退款终态标记等复用） */
    updateOrder(ctx, orderId, patch) {
        return this.connection.getRepository(ctx, core_2.Order).update(orderId, patch);
    }
    /** T0: 新单入厅即提醒在线骑手（订阅消息），失败只记日志不阻塞入厅。
     * 模板 ID 复用渠道 orderShippedTemplateId（wechat 插件未定义 campus 专用模板字段），
     * 未配置则跳过；逐骑手发送，单个失败不影响其余骑手。 */
    notifyRiders(ctx, order) {
        void (async () => {
            var _a, _b, _c;
            try {
                const templateId = ((_b = (_a = ctx.channel) === null || _a === void 0 ? void 0 : _a.customFields) !== null && _b !== void 0 ? _b : {}).orderShippedTemplateId;
                if (!templateId) {
                    core_2.Logger.debug(`Channel ${ctx.channelId} has no orderShippedTemplateId, skip rider notify`, 'CampusHall');
                    return;
                }
                const msg = this.injector.get(wechat_subscribe_message_plugin_1.SubscribeMessageService);
                const riders = await this.capacity.listOnlineRiders(ctx);
                for (const r of riders) {
                    try {
                        await msg.sendCustomMessage(ctx, r.id, templateId, {
                            orderCode: { value: order.code },
                            zone: { value: (_c = order.customFields.campusZone) !== null && _c !== void 0 ? _c : '' },
                        });
                    }
                    catch (e) {
                        core_2.Logger.warn(`rider notify failed (customer ${r.id}): ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusHall');
                    }
                }
            }
            catch (e) {
                core_2.Logger.warn(`rider notify failed: ${e === null || e === void 0 ? void 0 : e.message}`, 'CampusHall');
            }
        })();
    }
};
exports.HallService = HallService;
/** 预约单放量窗口：scheduledFor 前 30min 才进入商家确认/抢单大厅（plan 3.1） */
HallService.SCHEDULE_RELEASE_MIN = 30;
/** R5 交接码重发限流：同单 10 分钟一次（M4 经 dedupe 跨实例；未注入时退回进程内 Map） */
HallService.HANDOVER_RESEND_INTERVAL_MS = 10 * 60000;
exports.HallService = HallService = HallService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_2.TransactionalConnection,
        slot_lock_service_1.SlotLockService,
        core_1.ModuleRef,
        capacity_service_1.CapacityService,
        feishu_notify_service_1.FeishuNotifyService,
        campus_notify_service_1.CampusNotifyService,
        campus_dedupe_service_1.CampusDedupeService])
], HallService);
//# sourceMappingURL=hall.service.js.map