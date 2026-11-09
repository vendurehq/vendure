import {
    DashboardWidgetFilterComponentProps,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@vendure/dashboard';
import { Trans, useLingui } from '@lingui/react/macro';

/**
 * The id under which this filter's value is exposed to widgets via
 * `useWidgetFilters().filters[REGION_FILTER_ID]`.
 */
export const REGION_FILTER_ID = 'insights-test-region';

export const REGION_VALUES = ['all', 'europe', 'north-america', 'asia-pacific'] as const;

export type RegionValue = (typeof REGION_VALUES)[number];

/** Called at render time so the label goes through lingui rather than a hardcoded string. */
export function useRegionLabel() {
    const { t } = useLingui();
    const labels: Record<RegionValue, string> = {
        all: t`All regions`,
        europe: t`Europe`,
        'north-america': t`North America`,
        'asia-pacific': t`Asia Pacific`,
    };
    return (value: string) => labels[value as RegionValue] ?? value;
}

export function RegionFilter({ value, onChange }: DashboardWidgetFilterComponentProps<string>) {
    const regionLabel = useRegionLabel();
    const items = Object.fromEntries(REGION_VALUES.map(region => [region, regionLabel(region)]));
    return (
        <Select value={value} onValueChange={onChange} items={items}>
            <SelectTrigger className="w-44">
                <SelectValue placeholder={<Trans>Select a region</Trans>} />
            </SelectTrigger>
            <SelectContent>
                {REGION_VALUES.map(region => (
                    <SelectItem key={region} value={region}>
                        {regionLabel(region)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
