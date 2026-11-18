import { useEffect, useState } from 'react';

import { DateTimePicker } from '@/vdb/components/ui/date-picker.js';
import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isFieldDisabled } from '@/vdb/framework/form-engine/utils.js';
import { useDisplayLocale } from '@/vdb/hooks/use-display-locale.js';
import { useLingui } from '@lingui/react/macro';
import type { Locale } from 'date-fns/locale';

import { getDayPickerLocaleLoader } from './day-picker-locales.js';

/**
 * @description
 * Returns a `Locale` object that can be passed to the react-day-picker
 * `locale` prop. Only the locale of the current display language is loaded.
 */
export function useDayPickerLocale() {
    const { bcp47Tag } = useDisplayLocale();
    const [calendarLocale, setCalendarLocale] = useState<Locale | undefined>(undefined);
    useEffect(() => {
        const loader = getDayPickerLocaleLoader(bcp47Tag);
        if (!loader) {
            setCalendarLocale(undefined);
            return;
        }
        // A locale that finishes loading after the language has changed again is ignored
        let current = true;
        void loader().then(locale => {
            if (current) {
                setCalendarLocale(locale);
            }
        });
        return () => {
            current = false;
        };
    }, [bcp47Tag]);
    return calendarLocale;
}

/**
 * @description
 * A component for selecting a date and time.
 *
 * @docsCategory form-components
 * @docsPage DateTimeInput
 */
export function DateTimeInput({
    value,
    onChange,
    fieldDef,
    disabled,
}: Readonly<DashboardFormComponentProps>) {
    const { t } = useLingui();
    const readOnly = isFieldDisabled(disabled, fieldDef);
    // The form engine may hold either a `Date` (e.g. from a filter) or an ISO
    // string; the v2 picker is string-valued and edits the instant in the
    // user's local zone.
    const isoValue = value instanceof Date ? value.toISOString() : (value ?? undefined);

    return (
        <DateTimePicker
            value={isoValue || undefined}
            disabled={readOnly}
            placeholder={t`Pick a date and time`}
            onValueChange={next => onChange(next ?? null)}
        />
    );
}
