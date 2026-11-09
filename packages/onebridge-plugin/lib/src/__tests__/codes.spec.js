"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const codes_1 = require("../codes");
(0, vitest_1.describe)('businessDateStamp (explicit Asia/Seoul)', () => {
    (0, vitest_1.it)('rolls over to next day at Seoul midnight, independent of process TZ', () => {
        (0, vitest_1.expect)((0, codes_1.businessDateStamp)(new Date('2026-11-09T15:30:00Z'), codes_1.SEOUL_TIME_ZONE)).toBe('2026-11-10');
        (0, vitest_1.expect)((0, codes_1.businessDateStamp)(new Date('2026-11-09T14:59:00Z'), codes_1.SEOUL_TIME_ZONE)).toBe('2026-11-09');
    });
});
(0, vitest_1.describe)('document codes', () => {
    const at = new Date('2026-11-09T03:00:00Z');
    (0, vitest_1.it)('formats RFQ code as OB-YYYYMMDD-XXXX', () => {
        (0, vitest_1.expect)((0, codes_1.buildRfqCode)(at, 1)).toBe('OB-20261109-0001');
        (0, vitest_1.expect)((0, codes_1.buildRfqCode)(at, 42)).toBe('OB-20261109-0042');
    });
    (0, vitest_1.it)('formats inspection report code as QC-YYYYMMDD-NNNN', () => {
        (0, vitest_1.expect)((0, codes_1.buildInspectionCode)(at, 7)).toBe('QC-20261109-0007');
    });
    (0, vitest_1.it)('uses business-line order prefixes PP/SL/CKP', () => {
        (0, vitest_1.expect)((0, codes_1.buildBusinessLineOrderCode)('net', at, 1)).toBe('PP-20261109-0001');
        (0, vitest_1.expect)((0, codes_1.buildBusinessLineOrderCode)('pond', at, 1)).toBe('SL-20261109-0001');
        (0, vitest_1.expect)((0, codes_1.buildBusinessLineOrderCode)('hook', at, 1)).toBe('CKP-20261109-0001');
    });
    (0, vitest_1.it)('rejects invalid or overflowing sequences', () => {
        (0, vitest_1.expect)(() => (0, codes_1.formatSequence)(0)).toThrow();
        (0, vitest_1.expect)(() => (0, codes_1.formatSequence)(1.5)).toThrow();
        (0, vitest_1.expect)(() => (0, codes_1.formatSequence)(10000)).toThrow();
    });
});
//# sourceMappingURL=codes.spec.js.map