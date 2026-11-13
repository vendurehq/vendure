import { DateTime as UiDateTime } from '@vendure-io/ui/components/molecules/date-time';

/**
 * @description
 * Renders a date over a muted time, both formatted with the shared
 * `@vendure-io/ui` `DateTime` molecule. The molecule is deliberately a single
 * `<time>`, so this wrapper composes the two-line stack the dashboard uses. The
 * locale comes from the app-wide `FormatBridge` (mirroring `useLocalFormat`).
 * `formatOptions={{}}` reproduces the previous numeric-date rendering, and
 * `timeStyle: 'long'` the previous time rendering.
 */
export function DateTime({ value }: Readonly<{ value: string | Date }>) {
    return (
        <div className="flex flex-col">
            <UiDateTime value={value} formatOptions={{}} className="text-sm" />
            <UiDateTime
                value={value}
                formatOptions={{ timeStyle: 'long' }}
                className="text-xs text-muted-foreground"
            />
        </div>
    );
}
