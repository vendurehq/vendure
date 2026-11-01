"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campusCustomFields = void 0;
exports.campusCustomFields = {
    Order: [
        { name: 'fulfillmentRoute', type: 'string', nullable: true }, // R1..R5
        { name: 'orderKind', type: 'string', nullable: true, defaultValue: 'normal' },
        { name: 'buildingId', type: 'string', nullable: true },
        { name: 'campusZone', type: 'string', nullable: true },
        { name: 'deliveryDetail', type: 'string', nullable: true }, // 改址后的门牌/详细地址（覆盖下单地址展示）
        { name: 'hallStatus', type: 'string', nullable: true }, // open/grabbed
        { name: 'hallEnteredAt', type: 'datetime', nullable: true },
        { name: 'riderEarning', type: 'int', nullable: true },
        { name: 'tip', type: 'int', nullable: true },
        { name: 'deliverySlotId', type: 'string', nullable: true }, // ID 存 string，与 customFields 类型系统一致
        { name: 'deliverySlotText', type: 'string', nullable: true }, // '2026-10-06 11:00-11:30'
        { name: 'slotLocked', type: 'boolean', nullable: true, defaultValue: false }, // 时段锁位成功标记：仅锁定成功的单在取消时归还容量（防容量虚增）
        { name: 'errandKind', type: 'string', nullable: true }, // pickup_express / bring_food / buy / other
        { name: 'errandFrom', type: 'string', nullable: true },
        { name: 'errandTo', type: 'string', nullable: true },
        { name: 'errandNote', type: 'string', nullable: true }, // 跑腿物品描述/要求
        { name: 'leg1Status', type: 'string', nullable: true }, // R2: preparing / arrived_gate
        { name: 'handoverAt', type: 'datetime', nullable: true }, // R2 到校时间
        { name: 'campusCause', type: 'string', nullable: true }, // 对账标记: slot_full / no_rider
        { name: 'campusCancelCause', type: 'string', nullable: true }, // 取消归因: customer / system / ops（自动拉黑规则只统计 customer）
        { name: 'transferPhotos', type: 'string', list: true, nullable: true }, // 已取货转单拍照交接存证
        { name: 'transferNote', type: 'string', nullable: true },
        { name: 'transferAt', type: 'datetime', nullable: true },
        { name: 'riderLat', type: 'float', nullable: true }, // 骑手实时位置（gcj02），仅配送中写入，送达/转单清除
        { name: 'riderLng', type: 'float', nullable: true },
        { name: 'urged', type: 'boolean', nullable: true, defaultValue: false }, // 用户催单标记（plan 2.4）
        { name: 'urgedAt', type: 'datetime', nullable: true }, // 最近一次催单时间，10min 内禁止重复催
        { name: 'scheduledFor', type: 'datetime', nullable: true }, // 预约送达锚点=时段开始时间（plan 3.1），调度 job 到点前 30min 放量入厅
        { name: 'exceptionAction', type: 'string', nullable: true }, // 异常处置动作（plan 3.4）: reassign / refund_diff / coupon / refund_all
        { name: 'exceptionCompensation', type: 'int', nullable: true }, // 退差价金额（分）
        { name: 'exceptionCouponTemplateId', type: 'string', nullable: true }, // 补偿券模板 ID
        { name: 'exceptionHandledNote', type: 'string', nullable: true }, // 处置备注
        { name: 'exceptionHandledAt', type: 'datetime', nullable: true }, // 处置时间
        { name: 'exceptionHandledBy', type: 'string', nullable: true }, // 处置人（admin userId）
        { name: 'exceptionReportedAt', type: 'datetime', nullable: true }, // 骑手上报异常时间（调度超时升级基准）
        { name: 'routeGroupId', type: 'string', nullable: true }, // 多单顺路路线组（plan 3.3）：同楼栋+同时段打包，整组抢单
        { name: 'invoiceApplied', type: 'boolean', nullable: true, defaultValue: false }, // 开票申请幂等闸（个人中心 spec §4）
        { name: 'invoiceInfo', type: 'string', nullable: true }, // 开票申请快照 JSON：{titleName,titleType,taxNo,email,appliedAt}
        { name: 'waimaiPrintedAt', type: 'datetime', nullable: true }, // 商家小票最近打印时间（防重打 + 补打依据）
        { name: 'autoAcceptedAt', type: 'datetime', nullable: true }, // 自动接单时间（§69，每日上限统计与留痕）
        { name: 'note', type: 'string', nullable: true }, // 顾客整单备注（C 端下单填写，≤200 字，工作台展示 + 小票打印）
        { name: 'tablewareCount', type: 'int', nullable: true }, // 顾客餐具份数，0=无需餐具，null=未选择
        // 履约快照（下单固化，后台改配置不影响在途单）
        { name: 'deliveryPlan', type: 'string', nullable: true }, // merchant/owned/external_courier/campus_rider/self_pickup
        { name: 'handoverMode', type: 'string', nullable: true }, // to_campus_rider / direct_to_user
        { name: 'thirdPartyProvider', type: 'string', nullable: true }, // dada / meituan（运营中心派单时确定）
        { name: 'thirdPartyDeliveryOrderId', type: 'string', nullable: true }, // 网关内部单号
        { name: 'thirdPartyNo', type: 'string', nullable: true }, // 外部快递平台单号
        { name: 'thirdPartyState', type: 'string', nullable: true }, // pending/accepted/pickup/delivered/cancelled/exception
        { name: 'thirdPartyCourierName', type: 'string', nullable: true },
        { name: 'thirdPartyCourierPhone', type: 'string', nullable: true },
        { name: 'handoverPointName', type: 'string', nullable: true }, // 校园交接点快照（R1/R2）
        { name: 'handoverPointAddress', type: 'string', nullable: true },
        { name: 'handoverPointLat', type: 'float', nullable: true },
        { name: 'handoverPointLng', type: 'float', nullable: true },
        { name: 'thirdPartyDispatchAt', type: 'datetime', nullable: true }, // 推送外部快递时间
        { name: 'thirdPartySyncAt', type: 'datetime', nullable: true }, // 最近一次轮询对账外部运单时间（限频）
        // R7 外部异常转工单：工单关闭后回写，调度据此不再重复告警
        { name: 'exceptionResolvedAt', type: 'datetime', nullable: true },
        // 交接码（两段接力防丢餐扯皮）：第一段送达交接点时生成 4 位码，第二段骑手取货时校验
        { name: 'handoverCode', type: 'string', nullable: true },
        { name: 'handoverCodeAt', type: 'datetime', nullable: true },
        // 超时赔付：支付时固化承诺送达时间，送达超时后自动发定向券（幂等闸 + 归因留痕）
        { name: 'promisedAt', type: 'datetime', nullable: true },
        { name: 'promiseSource', type: 'string', nullable: true }, // slot / store_minutes
        { name: 'timeoutCompensatedAt', type: 'datetime', nullable: true },
        { name: 'timeoutCompensationCouponId', type: 'string', nullable: true },
        { name: 'timeoutLateMinutes', type: 'int', nullable: true },
        { name: 'timeoutAttribution', type: 'string', nullable: true }, // merchant / rider / platform
    ],
    Channel: [
        { name: 'waimaiTags', type: 'string', nullable: true }, // '米饭快餐,夜宵' 逗号分隔
        { name: 'waimaiMonthlySales', type: 'int', nullable: true },
        { name: 'waimaiLogo', type: 'string', nullable: true },
        { name: 'waimaiPromoText', type: 'string', nullable: true }, // 满减 tag 文案，如 '满20减4'（spec §12.2 增补）
        { name: 'waimaiBusinessHours', type: 'string', nullable: true }, // 店铺营业时间文案，如 10:00-22:00；C 端店铺页展示
        // 每日日报推送（§86）：营业结束后把昨日日报推到该店铺群（走 feishu broadcast，channel=店铺 code）
        { name: 'waimaiDailyPushEnabled', type: 'boolean', nullable: true, defaultValue: false },
        { name: 'waimaiDailyPushTime', type: 'string', nullable: true }, // 'HH:MM'，空=21:30
        { name: 'waimaiDailyPushLastDate', type: 'string', nullable: true }, // 幂等键：已推送的校园日 'YYYY-MM-DD'
        // §119 失败原因可见：最近一次失败的时间（epoch ms）与原因（≤200 字），成功推送后清空
        { name: 'waimaiDailyPushLastFailAt', type: 'string', nullable: true },
        { name: 'waimaiDailyPushLastFailReason', type: 'string', nullable: true },
        // 售后月度摘要推送（§95）：每月指定日把上月售后汇总推到店铺群
        { name: 'waimaiAfterSalesMonthlyPushEnabled', type: 'boolean', nullable: true, defaultValue: false },
        { name: 'waimaiAfterSalesMonthlyPushDay', type: 'int', nullable: true }, // 1-28，空=1
        { name: 'waimaiAfterSalesMonthlyPushTime', type: 'string', nullable: true }, // 'HH:MM'，空=21:30
        { name: 'waimaiAfterSalesMonthlyPushLastMonth', type: 'string', nullable: true }, // 幂等键：已推送的月份 'YYYY-MM'
        // 售后自动分配（§96）：按处理人未完结单量把新售后单指派给最空闲的人
        { name: 'waimaiAfterSalesAutoAssignEnabled', type: 'boolean', nullable: true, defaultValue: false },
        { name: 'waimaiAfterSalesAutoAssignMax', type: 'int', nullable: true }, // 单人未完结上限，0/空=不限
        // 售后异常预警推送（§96）：近 7 日退款率 / 超时待处理超过阈值时向店铺群推送
        { name: 'waimaiAfterSalesAlertEnabled', type: 'boolean', nullable: true, defaultValue: false },
        { name: 'waimaiAfterSalesAlertRefundRate', type: 'int', nullable: true }, // 退款率阈值（百分比），0/空=关闭该项
        { name: 'waimaiAfterSalesAlertOverdueCount', type: 'int', nullable: true }, // 超时待处理阈值（单），0/空=关闭该项
        { name: 'waimaiAfterSalesAlertLastDay', type: 'string', nullable: true }, // 幂等键：已预警的校园日 'YYYY-MM-DD'
        // 大额退款二次复核（§99）：申请退款金额达到阈值（分）时，需另一位管理员复核后才执行退款
        { name: 'waimaiAfterSalesReviewThreshold', type: 'int', nullable: true }, // 0/空=关闭
    ],
    Product: [
        { name: 'waimaiMonthlySales', type: 'int', nullable: true }, // 商品月销量，C 端菜单排序用，未设置按 0
        { name: 'waimaiSoldOut', type: 'boolean', nullable: true, defaultValue: false }, // 一键沽清：售罄仍展示、不可加购
        { name: 'waimaiPackingFee', type: 'int', nullable: true }, // 商品级打包费单价（分/件）；null=沿用店铺配置金额
        // 加料/小料组（P1-2）：JSON 字符串 AddonGroupConfig[]，空/null=该商品无加料
        { name: 'waimaiAddonGroups', type: 'text', nullable: true },
        // 套餐/组合内容（P1-2）：JSON 字符串 ComboConfig，空/null=非套餐商品（纯展示，价格由商品自身定价）
        { name: 'waimaiCombo', type: 'text', nullable: true },
        // 每日限量 / 每人限购（§68）：null 或 0 = 不限；额度按 UTC+8 当日已支付订单实时统计
        { name: 'waimaiDailyLimit', type: 'int', nullable: true },
        { name: 'waimaiPerUserLimit', type: 'int', nullable: true },
    ],
    OrderLine: [
        // 加料选择快照（P1-2）：JSON 字符串 AddonSelection[]，仅存 {g,n} 引用，金额结算时按商品配置服务端计价
        { name: 'waimaiAddons', type: 'text', nullable: true },
    ],
    Customer: [
        { name: 'riderStatus', type: 'string', nullable: true }, // none/pending/approved/suspended
        { name: 'riderRealName', type: 'string', nullable: true },
        { name: 'riderStudentNo', type: 'string', nullable: true },
        { name: 'riderCampus', type: 'string', nullable: true },
        { name: 'riderIdImg', type: 'string', nullable: true },
        { name: 'riderCredit', type: 'int', nullable: true, defaultValue: 100 },
        { name: 'riderOnlineAt', type: 'datetime', nullable: true }, // 心跳时间戳，「在线」= approved && 5min 内有心跳
        // P2-5 骑手合规：健康证 / 保险 / 背景调查（到期与未通过由 rider-compliance.ts 实时判定）
        { name: 'riderHealthCertNo', type: 'string', nullable: true },
        { name: 'riderHealthCertImg', type: 'string', nullable: true },
        { name: 'riderHealthCertExpiry', type: 'datetime', nullable: true },
        { name: 'riderInsuranceNo', type: 'string', nullable: true },
        { name: 'riderInsuranceExpiry', type: 'datetime', nullable: true },
        { name: 'riderBackgroundCheck', type: 'string', nullable: true }, // none/pending/passed/failed
        { name: 'riderBackgroundCheckAt', type: 'datetime', nullable: true },
        { name: 'avatarUrl', type: 'string', nullable: true }, // 头像 URL（uploadCustomerAsset 产物）
        { name: 'invoiceTitles', type: 'string', nullable: true }, // 发票抬头列表 JSON（≤5 条，spec §3.2）
        // P3-1 口味偏好云端同步：JSON {spicy, avoid[], allergens[], tableware}，与 C 端 utils/taste-profile.ts 同结构
        { name: 'tasteProfile', type: 'text', nullable: true },
    ],
    Address: [
        { name: 'zoneId', type: 'string', nullable: true }, // 校园分区 ID（campusZones 引用）
        { name: 'buildingId', type: 'string', nullable: true }, // 宿舍楼 ID（campusBuildings 引用）
        { name: 'route', type: 'string', nullable: true }, // 路线快照 R1..R5（备用）
    ],
};
//# sourceMappingURL=custom-fields.js.map