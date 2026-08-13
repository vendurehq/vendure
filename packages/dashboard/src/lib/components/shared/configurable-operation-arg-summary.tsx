import { getInputComponent } from '@/vdb/framework/extension-api/input-component-extensions.js';
import {
    ConfigurableFieldDef,
    DashboardFormComponentSummaryProps,
} from '@/vdb/framework/form-engine/form-engine-types.js';
import { extractFieldOptions, resolveInputComponentId } from '@/vdb/framework/form-engine/utils.js';
import { transformValue } from '@/vdb/framework/form-engine/value-transformers.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { ComponentType } from 'react';

/**
 * @description
 * Returns true if the given raw (json-string encoded) arg value is empty,
 * i.e. the arg has not yet been configured by the user.
 */
export function isEmptyArgValue(fieldDef: ConfigurableFieldDef, rawValue: string | undefined): boolean {
    if (rawValue == null || rawValue === '') {
        return true;
    }
    if (fieldDef.list) {
        const parsed = transformValue(rawValue, fieldDef, 'json-string', 'parse');
        return Array.isArray(parsed) && parsed.length === 0;
    }
    return false;
}

export interface ArgSummaryProps {
    fieldDef: ConfigurableFieldDef;
    /** The raw json-string encoded arg value */
    value: string;
    omitPrefix?: boolean;
    omitSuffix?: boolean;
}

export function shouldUseListCountSummary(
    isListField: boolean,
    value: unknown,
    listInputMode: boolean | 'dynamic' | undefined,
): boolean {
    const componentHandlesList = listInputMode === true || listInputMode === 'dynamic';
    return isListField && Array.isArray(value) && !componentHandlesList;
}

/**
 * @description
 * Renders a compact summary of a configurable operation arg value, used to
 * label the chips of the operation "sentence" UI.
 *
 * Resolution order:
 * 1. `metadata.summary` of the custom input component registered for the arg
 * 2. A built-in summary for known `ui.component` ids (facet values, product
 *    variants, customer groups, currency, select options)
 * 3. A default summary based on the arg type (boolean, datetime, list count,
 *    plain value)
 */
export function ArgSummary({ fieldDef, value, omitPrefix, omitSuffix }: Readonly<ArgSummaryProps>) {
    // Secret args default to the masked password summary, matching their input, so a redacted or
    // decrypted secret is not shown in plain text.
    const componentId = resolveInputComponentId(fieldDef);
    const CustomComponent = getInputComponent(componentId);
    const parsedValue = transformValue(value, fieldDef, 'json-string', 'parse');
    const isListValue = fieldDef.list === true && Array.isArray(parsedValue);
    const listInputMode = CustomComponent?.metadata?.isListInput;
    const useListCountSummary = shouldUseListCountSummary(fieldDef.list, parsedValue, listInputMode);

    const Summary = useListCountSummary
        ? DefaultArgSummary
        : (CustomComponent?.metadata?.summary ??
          (componentId ? BUILT_IN_SUMMARIES[componentId] : undefined) ??
          DefaultArgSummary);

    const isAffixedComponent =
        !isListValue && (componentId === 'number-form-input' || componentId === 'text-form-input');
    const prefix = isAffixedComponent && !omitPrefix ? fieldDef.ui?.prefix : undefined;
    const suffix = isAffixedComponent && !omitSuffix ? fieldDef.ui?.suffix : undefined;

    return (
        <>
            {prefix}
            <Summary value={parsedValue} fieldDef={fieldDef} />
            {suffix}
        </>
    );
}

function DefaultArgSummary({ value, fieldDef }: Readonly<DashboardFormComponentSummaryProps>) {
    const { t } = useLingui();
    const { formatDate } = useLocalFormat();
    if (Array.isArray(value)) {
        return <>{t`${value.length} selected`}</>;
    }
    if (fieldDef.type === 'boolean') {
        const isTrue = value === true || value === 'true';
        return <>{isTrue ? t`Yes` : t`No`}</>;
    }
    if (fieldDef.type === 'datetime' && value) {
        return <>{formatDate(value)}</>;
    }
    return <>{String(value)}</>;
}

function CurrencySummary({ value }: Readonly<DashboardFormComponentSummaryProps>) {
    const { activeChannel } = useChannel();
    const { formatCurrency, toMajorUnits, formatNumber } = useLocalFormat();
    const currencyCode = activeChannel?.defaultCurrencyCode;
    return (
        <>
            {currencyCode
                ? formatCurrency(Number(value), currencyCode)
                : formatNumber(toMajorUnits(Number(value)))}
        </>
    );
}

function PasswordSummary() {
    return <>{'\u2022'.repeat(8)}</>;
}

const MAX_TEXT_SUMMARY_LENGTH = 80;

export function compactText(value: unknown): { full: string; compact: string } {
    const raw = String(value ?? '')
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(
            /<\/(address|article|aside|blockquote|div|figcaption|figure|footer|header|h[1-6]|li|main|nav|ol|p|pre|section|table|tr|ul)>/gi,
            ' ',
        );
    let plainText: string;
    if (typeof DOMParser === 'undefined') {
        plainText = raw.replace(/<[^>]*>/g, ' ');
    } else {
        plainText = new DOMParser().parseFromString(raw, 'text/html').body.textContent ?? '';
    }
    const full = plainText.replace(/\s+/g, ' ').trim();
    const compact =
        full.length > MAX_TEXT_SUMMARY_LENGTH
            ? `${full.slice(0, MAX_TEXT_SUMMARY_LENGTH - 1).trimEnd()}\u2026`
            : full;
    return { full, compact };
}

function RichTextSummary({ value }: Readonly<DashboardFormComponentSummaryProps>) {
    const { full, compact } = compactText(value);
    return <span title={full}>{compact}</span>;
}

export type JsonSummary =
    | { type: 'items'; count: number }
    | { type: 'properties'; count: number }
    | { type: 'text'; value: string };

export function getJsonSummary(value: unknown): JsonSummary {
    let parsed = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value);
        } catch {
            return { type: 'text', value: compactText(value).compact };
        }
    }
    if (Array.isArray(parsed)) {
        return { type: 'items', count: parsed.length };
    }
    if (parsed !== null && typeof parsed === 'object') {
        return { type: 'properties', count: Object.keys(parsed).length };
    }
    return { type: 'text', value: String(parsed) };
}

function JsonSummary({ value }: Readonly<DashboardFormComponentSummaryProps>) {
    const { t } = useLingui();
    const summary = getJsonSummary(value);
    if (summary.type === 'items') {
        return <>{summary.count === 1 ? t`1 item` : t`${summary.count} items`}</>;
    }
    if (summary.type === 'properties') {
        return <>{summary.count === 1 ? t`1 property` : t`${summary.count} properties`}</>;
    }
    return <>{summary.value}</>;
}

function SelectOptionsSummary({ value, fieldDef }: Readonly<DashboardFormComponentSummaryProps>) {
    const {
        settings: { displayLanguage },
    } = useUserSettings();
    const options = extractFieldOptions(fieldDef);
    const labelFor = (val: any) => {
        const option = options.find(o => o.value === val);
        if (!option?.label) {
            return String(val);
        }
        const translation = option.label.find(l => l.languageCode === displayLanguage);
        return translation?.value ?? option.label[0]?.value ?? String(val);
    };
    const values = Array.isArray(value) ? value : [value];
    return <NameList names={values.map(labelFor)} />;
}

const facetValueSummaryDocument = graphql(`
    query FacetValueSummary($options: FacetValueListOptions) {
        facetValues(options: $options) {
            items {
                id
                name
                facet {
                    id
                    name
                }
            }
        }
    }
`);

function FacetValueSummary({ value }: Readonly<DashboardFormComponentSummaryProps>) {
    const ids = toIdArray(value);
    const { data } = useQuery({
        queryKey: ['FacetValueSummary', ids],
        queryFn: () => api.query(facetValueSummaryDocument, { options: { filter: { id: { in: ids } } } }),
        enabled: ids.length > 0,
        placeholderData: undefined,
    });
    const items = data?.facetValues.items;
    if (!items) {
        return <EntityCountFallback count={ids.length} />;
    }
    return <NameList names={items.map(item => `${item.name} (${item.facet.name})`)} />;
}

const productVariantSummaryDocument = graphql(`
    query ProductVariantSummary($options: ProductVariantListOptions) {
        productVariants(options: $options) {
            items {
                id
                name
            }
        }
    }
`);

function ProductVariantSummary({ value }: Readonly<DashboardFormComponentSummaryProps>) {
    const ids = toIdArray(value);
    const { data } = useQuery({
        queryKey: ['ProductVariantSummary', ids],
        queryFn: () => api.query(productVariantSummaryDocument, { options: { filter: { id: { in: ids } } } }),
        enabled: ids.length > 0,
        placeholderData: undefined,
    });
    const items = data?.productVariants.items;
    if (!items) {
        return <EntityCountFallback count={ids.length} />;
    }
    return <NameList names={items.map(item => item.name)} />;
}

const productSummaryDocument = graphql(`
    query ProductSummary($options: ProductListOptions) {
        products(options: $options) {
            items {
                id
                name
            }
        }
    }
`);

function ProductSummary({ value }: Readonly<DashboardFormComponentSummaryProps>) {
    const ids = toIdArray(value);
    const { data } = useQuery({
        queryKey: ['ProductSummary', ids],
        queryFn: () => api.query(productSummaryDocument, { options: { filter: { id: { in: ids } } } }),
        enabled: ids.length > 0,
        placeholderData: undefined,
    });
    const items = data?.products.items;
    if (!items) {
        return <EntityCountFallback count={ids.length} />;
    }
    return <NameList names={items.map(item => item.name)} />;
}

function ProductMultiSummary({ value, fieldDef }: Readonly<DashboardFormComponentSummaryProps>) {
    return fieldDef.ui?.selectionMode === 'variant' ? (
        <ProductVariantSummary value={value} fieldDef={fieldDef} />
    ) : (
        <ProductSummary value={value} fieldDef={fieldDef} />
    );
}

const customerGroupSummaryDocument = graphql(`
    query CustomerGroupSummary($options: CustomerGroupListOptions) {
        customerGroups(options: $options) {
            items {
                id
                name
            }
        }
    }
`);

function CustomerGroupSummary({ value }: Readonly<DashboardFormComponentSummaryProps>) {
    const ids = toIdArray(value);
    const { data } = useQuery({
        queryKey: ['CustomerGroupSummary', ids],
        queryFn: () => api.query(customerGroupSummaryDocument, { options: { filter: { id: { in: ids } } } }),
        enabled: ids.length > 0,
        placeholderData: undefined,
    });
    const items = data?.customerGroups.items;
    if (!items) {
        return <EntityCountFallback count={ids.length} />;
    }
    return <NameList names={items.map(item => item.name)} />;
}

const MAX_DISPLAYED_NAMES = 2;

function NameList({ names }: Readonly<{ names: string[] }>) {
    const displayed = names.slice(0, MAX_DISPLAYED_NAMES);
    const overflow = names.length - displayed.length;
    return (
        <span title={names.join(', ')}>
            {displayed.join(', ')}
            {overflow > 0 && <span className="text-muted-foreground"> +{overflow}</span>}
        </span>
    );
}

function EntityCountFallback({ count }: Readonly<{ count: number }>) {
    const { t } = useLingui();
    return <>{t`${count} selected`}</>;
}

function toIdArray(value: any): string[] {
    if (Array.isArray(value)) {
        return value.map(String);
    }
    if (value == null || value === '') {
        return [];
    }
    return [String(value)];
}

const BUILT_IN_SUMMARIES: Record<string, ComponentType<DashboardFormComponentSummaryProps>> = {
    'currency-form-input': CurrencySummary,
    'html-editor-form-input': RichTextSummary,
    'json-editor-form-input': JsonSummary,
    'password-form-input': PasswordSummary,
    'product-multi-form-input': ProductMultiSummary,
    'product-multi-input': ProductMultiSummary,
    'rich-text-form-input': RichTextSummary,
    'select-form-input': SelectOptionsSummary,
    'facet-value-form-input': FacetValueSummary,
    'facet-value-input': FacetValueSummary,
    'product-selector-form-input': ProductVariantSummary,
    'customer-group-form-input': CustomerGroupSummary,
};
