import { camelCaseToTitleCase } from '@/vdb/lib/utils.js';
import { useLingui } from '@lingui/react/macro';

/** `PaymentSettled` → `Payment settled`: a state name the catalog does not know reads as words. */
function camelCaseToSentenceCase(text: string): string {
    const words = camelCaseToTitleCase(text).trim();
    return words.replace(/ ([A-Z])(?![A-Z])/g, (_, letter: string) => ` ${letter.toLowerCase()}`);
}

export function useDynamicTranslations() {
    const { i18n, t } = useLingui();

    // Calling i18n.t() for an id missing from the catalog logs a
    // "Uncompiled message detected!" warning in production builds. The catalog
    // does not include every possible custom-field name or state name, so guard
    // the lookup instead of relying on i18n.t() returning the raw id.
    const translateOrFallback = (id: string, fallback: () => string) =>
        id in i18n.messages ? i18n.t(id) : fallback();

    // A list column of the `enabled` flag is headed "Status": its cells show a status badge.
    const getTranslatedFieldName = (fieldId: string) =>
        fieldId === 'enabled'
            ? t`Status`
            : translateOrFallback(`fieldName.${fieldId}`, () => camelCaseToTitleCase(fieldId));

    const getTranslatedOrderState = (state: string) =>
        translateOrFallback(`orderState.${state}`, () => camelCaseToSentenceCase(state));

    const getTranslatedFulfillmentState = (state: string) =>
        translateOrFallback(`fulfillmentState.${state}`, () => camelCaseToTitleCase(state));

    const getTranslatedPaymentState = (state: string) =>
        translateOrFallback(`paymentState.${state}`, () => camelCaseToTitleCase(state));

    const getTranslatedRefundState = (state: string) =>
        translateOrFallback(`refundState.${state}`, () => camelCaseToTitleCase(state));

    const getTranslatedRefundReason = (reason: string) =>
        translateOrFallback(`refundReason.${reason}`, () => camelCaseToTitleCase(reason));

    return {
        getTranslatedFieldName,
        getTranslatedOrderState,
        getTranslatedFulfillmentState,
        getTranslatedPaymentState,
        getTranslatedRefundState,
        getTranslatedRefundReason,
    };
}
