import { Switch as BaseSwitch } from '@vendure-io/ui/components/atoms/switch';
import { cn } from '@/vdb/lib/utils.js';
import { type ComponentProps, useRef } from 'react';

const NO_MOTION_CLASS = 'transition-none [&>[data-slot=switch-thumb]]:transition-none';

/**
 * Coerces null/undefined checked to false to avoid Base UI useControlled warnings.
 *
 * The thumb slides only when the user toggles the switch. A `checked` value that changes for any
 * other reason (an entity loads, a form resets) is shown without a transition.
 */
function Switch({ checked, onCheckedChange, className, ...props }: ComponentProps<typeof BaseSwitch>) {
    const isChecked = checked ?? false;
    const toggledByUser = useRef(false);
    const previousChecked = useRef(isChecked);
    const animate = useRef(false);
    if (previousChecked.current !== isChecked) {
        previousChecked.current = isChecked;
        animate.current = toggledByUser.current;
        toggledByUser.current = false;
    }
    return (
        <BaseSwitch
            checked={isChecked}
            onCheckedChange={(value, details) => {
                toggledByUser.current = true;
                onCheckedChange?.(value, details);
            }}
            className={state =>
                cn(
                    typeof className === 'function' ? className(state) : className,
                    !animate.current && NO_MOTION_CLASS,
                )
            }
            {...props}
        />
    );
}

export { Switch };
