import { describe, expect, it } from 'vitest';

import {
    buildBusinessLineOrderCode,
    buildInspectionCode,
    buildRfqCode,
    businessDateStamp,
    formatSequence,
    SEOUL_TIME_ZONE,
} from '../codes';

describe('businessDateStamp (explicit Asia/Seoul)', () => {
    it('rolls over to next day at Seoul midnight, independent of process TZ', () => {
        expect(businessDateStamp(new Date('2026-11-09T15:30:00Z'), SEOUL_TIME_ZONE)).toBe('2026-11-10');
        expect(businessDateStamp(new Date('2026-11-09T14:59:00Z'), SEOUL_TIME_ZONE)).toBe('2026-11-09');
    });
});

describe('document codes', () => {
    const at = new Date('2026-11-09T03:00:00Z');

    it('formats RFQ code as OB-YYYYMMDD-XXXX', () => {
        expect(buildRfqCode(at, 1)).toBe('OB-20261109-0001');
        expect(buildRfqCode(at, 42)).toBe('OB-20261109-0042');
    });

    it('formats inspection report code as QC-YYYYMMDD-NNNN', () => {
        expect(buildInspectionCode(at, 7)).toBe('QC-20261109-0007');
    });

    it('uses business-line order prefixes PP/SL/CKP', () => {
        expect(buildBusinessLineOrderCode('net', at, 1)).toBe('PP-20261109-0001');
        expect(buildBusinessLineOrderCode('pond', at, 1)).toBe('SL-20261109-0001');
        expect(buildBusinessLineOrderCode('hook', at, 1)).toBe('CKP-20261109-0001');
    });

    it('rejects invalid or overflowing sequences', () => {
        expect(() => formatSequence(0)).toThrow();
        expect(() => formatSequence(1.5)).toThrow();
        expect(() => formatSequence(10000)).toThrow();
    });
});
