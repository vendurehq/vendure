import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { Trans } from '@lingui/react/macro';

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
    const booleanValue = value === 'true' || value === true;

    // Only show for items after the first one
    const selectable = position !== undefined && position > 0;

    const setCombinationModeAnd = () => {
        onChange(true);
    };

    const setCombinationModeOr = () => {
        onChange(false);
    };

    if (!selectable) {
        return null;
    }

    return (
        <div className="flex items-center justify-center -mt-4 -mb-4">
            <div className="bg-muted border px-3 py-1.5 rounded-full flex gap-1.5 text-xs">
                <button
                    type="button"
                    disabled={disabled}
                    className={`px-2 py-0.5 rounded-full transition-colors ${
                        booleanValue
                            ? 'bg-primary text-background'
                            : 'text-muted-foreground hover:bg-muted-foreground/10'
                    }`}
                    onClick={setCombinationModeAnd}
                    {...props}
                >
                    <Trans>AND</Trans>
                </button>
                <button
                    type="button"
                    disabled={disabled}
                    className={`px-2 py-0.5 rounded-full transition-colors ${
                        !booleanValue
                            ? 'bg-primary text-background'
                            : 'text-muted-foreground hover:bg-muted-foreground/10'
                    }`}
                    onClick={setCombinationModeOr}
                    {...props}
                >
                    <Trans>OR</Trans>
                </button>
            </div>
        </div>
    );
};
