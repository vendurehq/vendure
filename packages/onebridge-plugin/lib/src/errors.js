"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Errors = exports.OnebridgeError = void 0;
exports.isOnebridgeError = isOnebridgeError;
const core_1 = require("@vendure/core");
const types_1 = require("./types");
/** 业务错误：extensions.code 与 CT-00 错误码表一致，M2 的 resolver 直接透出 */
class OnebridgeError extends core_1.I18nError {
    constructor(code, message) {
        super(message !== null && message !== void 0 ? message : code, {}, code, core_1.LogLevel.Warn);
    }
}
exports.OnebridgeError = OnebridgeError;
function isOnebridgeError(e) {
    return e instanceof OnebridgeError;
}
exports.Errors = {
    channelNotResolved: (expected, actual) => new OnebridgeError(types_1.ONEBRIDGE_ERROR_CODES.CHANNEL_NOT_RESOLVED, `Channel not resolved: expected ${expected}, got ${actual}`),
    rfqNotFound: (code) => new OnebridgeError(types_1.ONEBRIDGE_ERROR_CODES.RFQ_NOT_FOUND, code ? `RFQ ${code} not found` : undefined),
    orderNotFound: (code) => new OnebridgeError(types_1.ONEBRIDGE_ERROR_CODES.ORDER_NOT_FOUND, code ? `Order ${code} not found` : undefined),
    invalidTransition: (from, to) => new OnebridgeError(types_1.ONEBRIDGE_ERROR_CODES.INVALID_STAGE_TRANSITION, `Illegal stage transition: ${from} -> ${to}`),
    inspectionNotPassed: (rfqCode) => new OnebridgeError(types_1.ONEBRIDGE_ERROR_CODES.INVALID_STAGE_TRANSITION, `Inspection not passed for ${rfqCode}, release is blocked`),
    currencyMismatch: (expected, actual) => new OnebridgeError(types_1.ONEBRIDGE_ERROR_CODES.CURRENCY_MISMATCH, `Currency mismatch: channel expects ${expected}, got ${actual}`),
    validationFailed: (detail) => new OnebridgeError(types_1.ONEBRIDGE_ERROR_CODES.RFQ_VALIDATION_FAILED, detail),
    customsSyncFailed: (detail) => new OnebridgeError(types_1.ONEBRIDGE_ERROR_CODES.CUSTOMS_SYNC_FAILED, detail),
};
//# sourceMappingURL=errors.js.map