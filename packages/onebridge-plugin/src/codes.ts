import { BusinessLine } from './types';

/**
 * 单据编号生成（CT-01）。
 * 业务日期按显式时区换算（默认 Asia/Seoul），不依赖进程 TZ；日期为墙上时间，序号为当日自增。
 */

export const SEOUL_TIME_ZONE = 'Asia/Seoul';

/** 把绝对时刻格式化为业务时区的 YYYY-MM-DD（Asia/Seoul 墙上日期） */
export function businessDateStamp(date: Date, timeZone: string = SEOUL_TIME_ZONE): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 当日序号格式化为 4 位；超出 9999 直接报错，避免编号溢出 */
export function formatSequence(seq: number): string {
    if (!Number.isInteger(seq) || seq < 1) {
        throw new Error(`Invalid sequence: ${seq}`);
    }
    if (seq > 9999) {
        throw new Error(`Daily sequence overflow: ${seq}`);
    }
    return String(seq).padStart(4, '0');
}

/** RFQ 受理编号 OB-YYYYMMDD-XXXX */
export function buildRfqCode(date: Date, seq: number): string {
    return `OB-${businessDateStamp(date).replace(/-/g, '')}-${formatSequence(seq)}`;
}

/** 验货报告编号 QC-YYYYMMDD-NNNN */
export function buildInspectionCode(date: Date, seq: number): string {
    return `QC-${businessDateStamp(date).replace(/-/g, '')}-${formatSequence(seq)}`;
}

/** 订单/询盘/项目单编号 PP-/SL-/CKP-YYYYMMDD-NNNN */
export function buildBusinessLineOrderCode(line: BusinessLine, date: Date, seq: number): string {
    const prefix = line === 'net' ? 'PP' : line === 'pond' ? 'SL' : 'CKP';
    return `${prefix}-${businessDateStamp(date).replace(/-/g, '')}-${formatSequence(seq)}`;
}
