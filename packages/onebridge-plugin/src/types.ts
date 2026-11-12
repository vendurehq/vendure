/**
 * ONE BRIDGE 领域类型 —— 唯一事实源为《02-后台Vendure开发计划书》第 3 章（CT-01 / CT-02 / CT-06 / CT-07）。
 * 本文件的取值必须与文档逐字一致，新增同义值需走 CT-00 变更流程。
 */

/** 前台四模块（site/contact.html 的 data-key） */
export type NeedType = 'logistics' | 'daily' | 'collections' | 'projects';

/** 运营业务线（demo/data.js 的 PLANS） */
export type BusinessLine = 'net' | 'pond' | 'hook';

/** 站点语言（默认 ko） */
export type LocaleCode = 'ko' | 'zh';

/** 金额币种（Channel 默认 KRW；CNY 仅供采购/结算侧） */
export type CurrencyCode = 'KRW' | 'CNY';

/**
 * 14 个跨境业务阶段，逐字取自 demo/data.js 的 STATUS 键。
 * 注意：这是「业务阶段」，不是 Vendure OrderState，不得塞进 OrderProcess。
 */
export type CrossBorderStage =
    | 'lost'
    | 'wait_pay'
    | 'quoting'
    | 'requirement'
    | 'sourcing'
    | 'risk'
    | 'sample'
    | 'producing'
    | 'shipping'
    | 'qc'
    | 'refund'
    | 'delivered'
    | 'customs'
    | 'done';

/** 时间轴节点状态（demo/data.js buildTimeline 输出） */
export type StageEventState = 'done' | 'now' | 'todo';

/** 清关子状态（CT-06） */
export type CustomsStatus = 'not_started' | 'docs_preparing' | 'declared' | 'inspecting' | 'cleared' | 'hold';

/** 验货报告结论（CT-07） */
export type InspectionResult = 'pass' | 'fail' | 'conditional';

/** 内容实体分类（CT-03：专栏 / 案例 / 物流通道 / 全站块） */
export type ContentType = 'column' | 'case' | 'logistics_channel' | 'site_block';

/**
 * 客户分级取值（CT-01）。取值含韩文，GraphQL 枚举名不允许非 ASCII，
 * 因此以 String/customField 存储，schema 层用字符串而非 enum。
 */
export type CustomerTier =
    | '일반'
    | '우수'
    | 'VIP'
    | '기업_A'
    | '기업_B'
    | '기업_C'
    | '전략_고객'
    | '기관'
    | '산지_파트너';

/** StageEvent 归属对象类型（CT-10：询价单 / 订单） */
export type StageOwnerType = 'rfq' | 'order';

export const NEED_TYPES: readonly NeedType[] = ['logistics', 'daily', 'collections', 'projects'];

export const BUSINESS_LINES: readonly BusinessLine[] = ['net', 'pond', 'hook'];

export const CROSS_BORDER_STAGES: readonly CrossBorderStage[] = [
    'lost',
    'wait_pay',
    'quoting',
    'requirement',
    'sourcing',
    'risk',
    'sample',
    'producing',
    'shipping',
    'qc',
    'refund',
    'delivered',
    'customs',
    'done',
];

export const CUSTOMS_STATUSES: readonly CustomsStatus[] = [
    'not_started',
    'docs_preparing',
    'declared',
    'inspecting',
    'cleared',
    'hold',
];

export const INSPECTION_RESULTS: readonly InspectionResult[] = ['pass', 'fail', 'conditional'];

export const CONTENT_TYPES: readonly ContentType[] = ['column', 'case', 'logistics_channel', 'site_block'];

export const CUSTOMER_TIERS: readonly CustomerTier[] = [
    '일반',
    '우수',
    'VIP',
    '기업_A',
    '기업_B',
    '기업_C',
    '전략_고객',
    '기관',
    '산지_파트너',
];

/** 业务错误码（CT-00），GraphQL extensions.code 直接使用 */
export const ONEBRIDGE_ERROR_CODES = {
    CHANNEL_NOT_RESOLVED: 'CHANNEL_NOT_RESOLVED',
    RFQ_NOT_FOUND: 'RFQ_NOT_FOUND',
    ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
    INVALID_STAGE_TRANSITION: 'INVALID_STAGE_TRANSITION',
    CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
    STOCK_INSUFFICIENT: 'STOCK_INSUFFICIENT',
    PAYMENT_CALLBACK_DUPLICATE: 'PAYMENT_CALLBACK_DUPLICATE',
    PAYMENT_CALLBACK_SIGNATURE_MISSING: 'PAYMENT_CALLBACK_SIGNATURE_MISSING',
    PAYMENT_CALLBACK_SIGNATURE_INVALID: 'PAYMENT_CALLBACK_SIGNATURE_INVALID',
    CUSTOMS_SYNC_FAILED: 'CUSTOMS_SYNC_FAILED',
    RFQ_VALIDATION_FAILED: 'RFQ_VALIDATION_FAILED',
} as const;

export type OnebridgeErrorCode = (typeof ONEBRIDGE_ERROR_CODES)[keyof typeof ONEBRIDGE_ERROR_CODES];

/** 单据编号前缀（CT-01） */
export const BUSINESS_LINE_ORDER_PREFIX: Record<BusinessLine, 'PP' | 'SL' | 'CKP'> = {
    net: 'PP',
    pond: 'SL',
    hook: 'CKP',
};

/** RFQ 受理编号前缀（fusion/a.js 受理回执） */
export const RFQ_CODE_PREFIX = 'OB';

/** 验货报告编号前缀（CT-07） */
export const INSPECTION_CODE_PREFIX = 'QC';

export interface OnebridgePluginOptions {
    /** ONE BRIDGE Channel token；未显式传入时按请求上下文 ctx.channel.token 判定 */
    channelToken?: string;
}

export const ONEBRIDGE_PLUGIN_OPTIONS = Symbol('ONEBRIDGE_PLUGIN_OPTIONS');
export const loggerCtx = 'OnebridgePlugin';
