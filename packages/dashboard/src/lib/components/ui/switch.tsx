import { Switch as BaseSwitch } from '@vendure-io/ui/components/ui/switch';
import { type ComponentProps } from 'react';

/** Coerces null/undefined checked to false to avoid Base UI useControlled warnings. */
function Switch({ checked, ...props }: ComponentProps<typeof BaseSwitch>) {
    return <BaseSwitch checked={checked ?? false} {...props} />;
}

export { Switch };
