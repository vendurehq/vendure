import { ID, Order, RequestContext, TransactionalConnection } from '@vendure/core';
import { CampusDedupeService } from './campus-dedupe.service';
import { CampusNotifyService } from './campus-notify.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { HallService } from './hall.service';
import { PrivacyNumberService } from './privacy-number.service';
import { RiderCreditService } from './rider-credit.service';
import { RiderService } from './rider.service';
export declare class RiderTaskService {
    private connection;
    private riderService;
    private credit;
    private hall;
    private notify;
    private privacy;
    private feishu?;
    /** M5 跨实例交接码防爆破（多实例下失败计数与锁止共享）；未注入退回进程内 Map */
    private dedupe?;
    /** A3：骑手主动重发交接码的限频窗口（同单 3 分钟）；跨实例用 dedupe，未注入时退回进程内 Map */
    static readonly HANDOVER_RIDER_RESEND_MS: number;
    /** 交接码连续错误计数 / 锁止截止时间（orderId 维度；M5 经 dedupe 跨实例，未注入时退回进程内 Map） */
    private handoverFails;
    private handoverLockUntil;
    /** 进程内重发限频（未注入 dedupe 时使用） */
    private riderResendAt;
    constructor(connection: TransactionalConnection, riderService: RiderService, credit: RiderCreditService, hall: HallService, notify: CampusNotifyService, privacy: PrivacyNumberService, feishu?: FeishuNotifyService | undefined, 
    /** M5 跨实例交接码防爆破（多实例下失败计数与锁止共享）；未注入退回进程内 Map */
    dedupe?: CampusDedupeService | undefined);
    /** 骑手侧顾客联系方式（号码保护）：仅本单骑手可查，真实号不出服务端。
     * 未开启号码保护时返回真实号（行为与旧版一致），前端统一用 display/callable 展示与拨号。 */
    customerContact(ctx: RequestContext, orderId: ID): Promise<import("./privacy-number.service").PrivacyContact>;
    /** 订单骑手卡信息：C 端订单跟踪轮询用。未指派返回 null。
     * 位置（plan 2.2）：仅配送中（assigned/in_progress）返回，送达/异常/转单不暴露（隐私）。
     * 跟踪页：附带目标楼栋坐标与直线距离/ETA（楼栋无坐标时均为 null，前端降级）。
     * 归属校验：仅下单人本人可查（原实现可越权读任意订单骑手位置）。 */
    orderRider(ctx: RequestContext, orderId: ID): Promise<{
        realName: any;
        credit: any;
        phone: null;
        location: {
            lat: number;
            lng: number;
        } | null;
        destination: {
            name: string;
            detail: string | null;
            lat: number;
            lng: number;
        } | null;
        distanceMeters: number | null;
        etaMinutes: number | null;
        deliveryStatus: any;
    } | null>;
    /** 骑手位置上报：本人订单 + 仅 assigned/in_progress 可写（plan 2.2，10s/次）。 */
    reportLocation(ctx: RequestContext, orderId: ID, lat: number, lng: number): Promise<Order>;
    /** 用户催单（plan 2.4）：仅下单人本人；校园履约单未终态可催（含待接单/大厅阶段）；10min 内重复催单拒绝。
     * 一期催单不推送骑手（骑手端任务卡轮询读 customFields.urged 显示提醒），大厅阶段由调度墙「顾客催单」告警提示运营。 */
    urgeOrder(ctx: RequestContext, orderId: ID): Promise<Order>;
    /** 我的任务：本骑手名下已进入配送流程的订单，按下单时间倒序。
     * customFields 为嵌入式物理列，QueryBuilder 用 embedded 路径 order.customFields.deliveryStaffId
     * （与 delivery-plugin 写法一致），裸列 order.deliveryStaffId 在 PG 不存在。
     * 渠道过滤：Order 无标量 channelId，join order.channels 过滤 channel.id（同 hall()）。 */
    myTasks(ctx: RequestContext, status?: string): Promise<Order[]>;
    /** 转单回大厅：assigned 未取货直接回；in_progress 已取货必须拍照交接存证。
     * 回大厅复用 backToHall（清骑手指派、hallStatus 复位 open），存证写 transferPhotos。
     * 一期转单不扣信用分（规则后续租户可配）。 */
    transfer(ctx: RequestContext, orderId: ID, photos: string[], note?: string): Promise<Order>;
    /** 开始配送：assigned → in_progress。
     * 两段接力单（R1/R2 第一段已送达交接点并生成了 handoverCode）必须校验交接码，防丢餐扯皮。 */
    start(ctx: RequestContext, orderId: ID, code?: string): Promise<Order>;
    /** R5 交接码重发后清空该单错误计数与锁定（新码生效，旧失败次数不应继续累计） */
    resetHandoverGuard(orderId: ID): Promise<void>;
    /** 是否处于交接码锁止期（跨实例：dedupe 优先，未注入退回进程内 Map） */
    private handoverLocked;
    /** 记一次交接码错误；达到阈值转为 10 分钟锁止 */
    private recordHandoverFail;
    private clearHandoverGuard;
    /** 交接码读取（R1/R2 第二段起送必填）：仅本单骑手、assigned/in_progress 可读。
     *  原实现交接码只写入不暴露，骑手只能线下向交接点口头索取，取不到就卡在 grabbed 直到超时回厅。 */
    handoverCode(ctx: RequestContext, orderId: ID): Promise<string | null>;
    /**
     * A3：骑手在「已派单、未取餐」时主动重发交接码。
     * - 复用 A2 同一生成器与 TTL（新码 10 分钟内有效）；
     * - 单条 CAS 覆盖 handoverCode/handoverCodeAt：旧码即刻失效，不存在新旧码同时可用；
     * - 限频：同单 3 分钟内只能重发一次（dedupe 跨实例计数，未注入退回进程内 Map），防无限刷新；
     * - 成功后清空交接码错误计数/锁止，避免旧码连错 5 次的锁止影响新码。
     * 仅本单骑手（assertOwner 校验归属与 assigned 状态）。
     */
    resendHandoverCode(ctx: RequestContext, orderId: ID): Promise<string>;
    /** 同单 3 分钟限频：dedupe 走原子计数（跨实例），未注入退回进程内 Map */
    private claimRiderResendWindow;
    private releaseRiderResendWindow;
    /** 送达：拍照必传 → delivered → 分成入余额（0 分成单跳过入账） */
    deliver(ctx: RequestContext, orderId: ID, photos: string[], note?: string): Promise<Order>;
    /** 异常上报：仅配送中（已接单/配送中）可上报，记录上报时间供调度扫描超时升级 */
    reportException(ctx: RequestContext, orderId: ID, type: string, photos: string[], note?: string): Promise<Order>;
    /** 实收跑腿小费：以订单小费 surcharge 合计为准（0 元小费在 errand.service 只清不加） */
    private actualTip;
    private calcEarning;
    /** 配送配置按订单所属渠道解析（P2）：跨店骑手请求头渠道与订单渠道不一致时，佣金比例必须锚定订单渠道 */
    private getConfig;
    private assertOwner;
}
