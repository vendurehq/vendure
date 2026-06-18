import { Checkbox as BaseCheckbox } from '@vendure-io/ui/components/ui/checkbox';
import { type ComponentProps } from 'react';

/** Coerces null/undefined checked to false to avoid Base UI useControlled warnings. */
function Checkbox({ checked, ...props }: ComponentProps<typeof BaseCheckbox>) {
    return <BaseCheckbox checked={checked ?? false} {...props} />;
}

export { Checkbox };
