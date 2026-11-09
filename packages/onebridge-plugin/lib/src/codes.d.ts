import { BusinessLine } from './types';
/**
 * 单据编号生成（CT-01）。
 * 业务日期按显式时区换算（默认 Asia/Seoul），不依赖进程 TZ；日期为墙上时间，序号为当日自增。
 */
export declare const SEOUL_TIME_ZONE = "Asia/Seoul";
/** 把绝对时刻格式化为业务时区的 YYYY-MM-DD（Asia/Seoul 墙上日期） */
export declare function businessDateStamp(date: Date, timeZone?: string): string;
/** 当日序号格式化为 4 位；超出 9999 直接报错，避免编号溢出 */
export declare function formatSequence(seq: number): string;
/** RFQ 受理编号 OB-YYYYMMDD-XXXX */
export declare function buildRfqCode(date: Date, seq: number): string;
/** 验货报告编号 QC-YYYYMMDD-NNNN */
export declare function buildInspectionCode(date: Date, seq: number): string;
/** 订单/询盘/项目单编号 PP-/SL-/CKP-YYYYMMDD-NNNN */
export declare function buildBusinessLineOrderCode(line: BusinessLine, date: Date, seq: number): string;
