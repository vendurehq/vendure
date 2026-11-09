import { I18nError, LogLevel } from '@vendure/core';

import { OnebridgeErrorCode, ONEBRIDGE_ERROR_CODES } from './types';

/** 业务错误：extensions.code 与 CT-00 错误码表一致，M2 的 resolver 直接透出 */
export class OnebridgeError extends I18nError {
    constructor(code: OnebridgeErrorCode, message?: string) {
        super(message ?? code, {}, code, LogLevel.Warn);
    }
}

export function isOnebridgeError(e: unknown): e is OnebridgeError {
    return e instanceof OnebridgeError;
}

export const Errors = {
    channelNotResolved: (expected: string, actual: string) =>
        new OnebridgeError(
            ONEBRIDGE_ERROR_CODES.CHANNEL_NOT_RESOLVED,
            `Channel not resolved: expected ${expected}, got ${actual}`,
        ),
    rfqNotFound: (code?: string) =>
        new OnebridgeError(ONEBRIDGE_ERROR_CODES.RFQ_NOT_FOUND, code ? `RFQ ${code} not found` : undefined),
    orderNotFound: (code?: string) =>
        new OnebridgeError(ONEBRIDGE_ERROR_CODES.ORDER_NOT_FOUND, code ? `Order ${code} not found` : undefined),
    invalidTransition: (from: string, to: string) =>
        new OnebridgeError(
            ONEBRIDGE_ERROR_CODES.INVALID_STAGE_TRANSITION,
            `Illegal stage transition: ${from} -> ${to}`,
        ),
    inspectionNotPassed: (rfqCode: string) =>
        new OnebridgeError(
            ONEBRIDGE_ERROR_CODES.INVALID_STAGE_TRANSITION,
            `Inspection not passed for ${rfqCode}, release is blocked`,
        ),
    currencyMismatch: (expected: string, actual: string) =>
        new OnebridgeError(
            ONEBRIDGE_ERROR_CODES.CURRENCY_MISMATCH,
            `Currency mismatch: channel expects ${expected}, got ${actual}`,
        ),
    validationFailed: (detail: string) => new OnebridgeError(ONEBRIDGE_ERROR_CODES.RFQ_VALIDATION_FAILED, detail),
    customsSyncFailed: (detail?: string) =>
        new OnebridgeError(ONEBRIDGE_ERROR_CODES.CUSTOMS_SYNC_FAILED, detail),
};
