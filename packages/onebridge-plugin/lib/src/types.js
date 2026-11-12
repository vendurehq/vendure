"use strict";
/**
 * ONE BRIDGE 领域类型 —— 唯一事实源为《02-后台Vendure开发计划书》第 3 章（CT-01 / CT-02 / CT-06 / CT-07）。
 * 本文件的取值必须与文档逐字一致，新增同义值需走 CT-00 变更流程。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loggerCtx = exports.ONEBRIDGE_PLUGIN_OPTIONS = exports.INSPECTION_CODE_PREFIX = exports.RFQ_CODE_PREFIX = exports.BUSINESS_LINE_ORDER_PREFIX = exports.ONEBRIDGE_ERROR_CODES = exports.CUSTOMER_TIERS = exports.CONTENT_TYPES = exports.INSPECTION_RESULTS = exports.CUSTOMS_STATUSES = exports.CROSS_BORDER_STAGES = exports.BUSINESS_LINES = exports.NEED_TYPES = void 0;
exports.NEED_TYPES = ['logistics', 'daily', 'collections', 'projects'];
exports.BUSINESS_LINES = ['net', 'pond', 'hook'];
exports.CROSS_BORDER_STAGES = [
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
exports.CUSTOMS_STATUSES = [
    'not_started',
    'docs_preparing',
    'declared',
    'inspecting',
    'cleared',
    'hold',
];
exports.INSPECTION_RESULTS = ['pass', 'fail', 'conditional'];
exports.CONTENT_TYPES = ['column', 'case', 'logistics_channel', 'site_block'];
exports.CUSTOMER_TIERS = [
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
exports.ONEBRIDGE_ERROR_CODES = {
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
};
/** 单据编号前缀（CT-01） */
exports.BUSINESS_LINE_ORDER_PREFIX = {
    net: 'PP',
    pond: 'SL',
    hook: 'CKP',
};
/** RFQ 受理编号前缀（fusion/a.js 受理回执） */
exports.RFQ_CODE_PREFIX = 'OB';
/** 验货报告编号前缀（CT-07） */
exports.INSPECTION_CODE_PREFIX = 'QC';
exports.ONEBRIDGE_PLUGIN_OPTIONS = Symbol('ONEBRIDGE_PLUGIN_OPTIONS');
exports.loggerCtx = 'OnebridgePlugin';
//# sourceMappingURL=types.js.map