import { I18nError } from '@vendure/core';
import { OnebridgeErrorCode } from './types';
/** 业务错误：extensions.code 与 CT-00 错误码表一致，M2 的 resolver 直接透出 */
export declare class OnebridgeError extends I18nError {
    constructor(code: OnebridgeErrorCode, message?: string);
}
export declare function isOnebridgeError(e: unknown): e is OnebridgeError;
export declare const Errors: {
    channelNotResolved: (expected: string, actual: string) => OnebridgeError;
    rfqNotFound: (code?: string) => OnebridgeError;
    orderNotFound: (code?: string) => OnebridgeError;
    invalidTransition: (from: string, to: string) => OnebridgeError;
    inspectionNotPassed: (rfqCode: string) => OnebridgeError;
    currencyMismatch: (expected: string, actual: string) => OnebridgeError;
    validationFailed: (detail: string) => OnebridgeError;
    customsSyncFailed: (detail?: string) => OnebridgeError;
};
