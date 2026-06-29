import { camelCaseToTitleCase } from '@/vdb/lib/utils.js';
import { useLingui } from '@lingui/react';

export function useDynamicTranslations() {
    const { i18n } = useLingui();

    // Calling i18n.t() for an id missing from the catalog logs a
    // "Uncompiled message detected!" warning in production builds. The catalog
    // does not include every possible custom-field name or state name, so guard
    // the lookup instead of relying on i18n.t() returning the raw id.
    const translateOrFallback = (id: string, fallback: () => string) =>
        id in i18n.messages ? i18n.t(id) : fallback();

    const getTranslatedFieldName = (fieldId: string) =>
        translateOrFallback(`fieldName.${fieldId}`, () => camelCaseToTitleCase(fieldId));

    const getTranslatedOrderState = (state: string) =>
        translateOrFallback(`orderState.${state}`, () => camelCaseToTitleCase(state));

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
