import { OrderProcess, TransactionalConnection, UserInputError } from '@vendure/core';
import { ClosureDate } from './closure-calendar';
import { type RouteConfig } from './route-matrix';
export declare function bindOrderGateConnection(conn: TransactionalConnection): void;
export declare const BLACKLIST_MESSAGE = "\u8BE5\u8D26\u53F7\u6682\u4E0D\u53EF\u4E0B\u5355\uFF0C\u5982\u6709\u7591\u95EE\u8BF7\u8054\u7CFB\u5546\u5BB6\u5BA2\u670D";
/** 黑名单校验：返回 true 表示命中（导出便于单测） */
export declare function isBlacklisted(conn: TransactionalConnection, channelId: number, orderId: number): Promise<boolean>;
/** 沽清校验：返回首个售罄商品名（null=全部可售） */
export declare function findSoldOutProductName(conn: TransactionalConnection, orderId: number): Promise<string | null>;
/** 营业日历（§70）：读取本渠道休业名单，命中今日返回该条目（null=今日正常营业） */
export declare function findTodayClosure(conn: TransactionalConnection, channelId: number, now?: number): Promise<ClosureDate | null>;
export declare const R1_NO_HANDOVER_MESSAGE = "\u5F53\u524D\u95E8\u5E97\u672A\u914D\u7F6E R1 \u914D\u9001\u4EA4\u63A5\u70B9\uFF0C\u6682\u4E0D\u53EF\u9009\u62E9 R1\uFF0C\u8BF7\u6539\u9009 R3 \u6216\u5230\u5E97\u81EA\u53D6";
/** A1：前端/告警可依据 GraphQL extensions.code 区分原因（文案面向顾客） */
export declare const R1_NO_HANDOVER_CODE = "CAMPUS_R1_NO_HANDOVER_POINT";
/** A1：R1 渠道缺少可用交接点（Vendure 的 UserInputError 固定 code=USER_INPUT_ERROR，
 *  这里在 extensions 上补一个可机读的业务码，message 保持面向顾客可读）。 */
export declare class CampusR1NoHandoverError extends UserInputError {
    constructor();
}
/**
 * 读取渠道交接点配置（只读）。
 * simple-json 列经 pg 驱动可能回传对象，也可能回传字符串，统一解析成 RouteConfig。
 */
export declare function findChannelRouteConfig(conn: TransactionalConnection, channelId: number): Promise<RouteConfig | null>;
export declare const campusOrderGateProcess: OrderProcess<any>;
