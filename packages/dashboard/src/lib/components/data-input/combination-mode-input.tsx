import { ToggleGroup, ToggleGroupItem } from '@/vdb/components/ui/toggle-group.js';
import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { Trans, useLingui } from '@lingui/react/macro';

export type CombinationModeInputProps = DashboardFormComponentProps & {
    position?: number;
};

export const CombinationModeInput = ({
    value,
    onChange,
    position,
    disabled,
    ...props
}: Readonly<CombinationModeInputProps>) => {
    const { t } = useLingui();
    const booleanValue = value === 'true' || value === true;

    // Only show for items after the first one
    const selectable = position !== undefined && position > 0;

    if (!selectable) {
        return null;
    }

    return (
        <ToggleGroup
            variant="outline"
            size="sm"
            value={[booleanValue ? 'and' : 'or']}
            onValueChange={values => {
                // Keep one item pressed: a click on the pressed item clears the group.
                if (values.length > 0) {
                    onChange(values[0] === 'and');
                }
            }}
            disabled={disabled}
            aria-label={t`Combine with the condition before`}
            {...props}
        >
            <ToggleGroupItem value="and">
                <Trans>AND</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="or">
                <Trans>OR</Trans>
            </ToggleGroupItem>
        </ToggleGroup>
    );
};
