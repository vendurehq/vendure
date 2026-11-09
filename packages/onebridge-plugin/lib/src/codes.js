"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEOUL_TIME_ZONE = void 0;
exports.businessDateStamp = businessDateStamp;
exports.formatSequence = formatSequence;
exports.buildRfqCode = buildRfqCode;
exports.buildInspectionCode = buildInspectionCode;
exports.buildBusinessLineOrderCode = buildBusinessLineOrderCode;
/**
 * 单据编号生成（CT-01）。
 * 业务日期按显式时区换算（默认 Asia/Seoul），不依赖进程 TZ；日期为墙上时间，序号为当日自增。
 */
exports.SEOUL_TIME_ZONE = 'Asia/Seoul';
/** 把绝对时刻格式化为业务时区的 YYYY-MM-DD（Asia/Seoul 墙上日期） */
function businessDateStamp(date, timeZone = exports.SEOUL_TIME_ZONE) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const get = (type) => { var _a, _b; return (_b = (_a = parts.find(p => p.type === type)) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : ''; };
    return `${get('year')}-${get('month')}-${get('day')}`;
}
/** 当日序号格式化为 4 位；超出 9999 直接报错，避免编号溢出 */
function formatSequence(seq) {
    if (!Number.isInteger(seq) || seq < 1) {
        throw new Error(`Invalid sequence: ${seq}`);
    }
    if (seq > 9999) {
        throw new Error(`Daily sequence overflow: ${seq}`);
    }
    return String(seq).padStart(4, '0');
}
/** RFQ 受理编号 OB-YYYYMMDD-XXXX */
function buildRfqCode(date, seq) {
    return `OB-${businessDateStamp(date).replace(/-/g, '')}-${formatSequence(seq)}`;
}
/** 验货报告编号 QC-YYYYMMDD-NNNN */
function buildInspectionCode(date, seq) {
    return `QC-${businessDateStamp(date).replace(/-/g, '')}-${formatSequence(seq)}`;
}
/** 订单/询盘/项目单编号 PP-/SL-/CKP-YYYYMMDD-NNNN */
function buildBusinessLineOrderCode(line, date, seq) {
    const prefix = line === 'net' ? 'PP' : line === 'pond' ? 'SL' : 'CKP';
    return `${prefix}-${businessDateStamp(date).replace(/-/g, '')}-${formatSequence(seq)}`;
}
//# sourceMappingURL=codes.js.map