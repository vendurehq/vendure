import { ReactNode, useEffect, useRef, useState } from 'react';
import { Input } from '../ui/input.js';

import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isReadonlyField } from '@/vdb/framework/form-engine/utils.js';

export type AffixedInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> &
    DashboardFormComponentProps & {
        prefix?: ReactNode;
        suffix?: ReactNode;
    };

/**
 * @description
 * A component for displaying an input with a prefix and/or a suffix.
 *
 * @example
 * ```tsx
 * <AffixedInput
 *     {...field}
 *     type="number"
 *     suffix="%"
 *     value={field.value}
 *     onChange={e => field.onChange(e.target.valueAsNumber)}
 * />
 * ```
 *
 * @docsCategory form-components
 * @docsPage AffixedInput
 */
export function AffixedInput({
    prefix,
    suffix,
    className = '',
    fieldDef,
    ...inputProps
}: Readonly<AffixedInputProps>) {
    const readOnly = inputProps.disabled || isReadonlyField(fieldDef);
    const prefixRef = useRef<HTMLSpanElement>(null);
    const suffixRef = useRef<HTMLSpanElement>(null);
    const [prefixWidth, setPrefixWidth] = useState(0);
    const [suffixWidth, setSuffixWidth] = useState(0);

    useEffect(() => {
        if (prefixRef.current) {
            setPrefixWidth(Math.round(prefixRef.current.getBoundingClientRect().width));
        }
        if (suffixRef.current) {
            setSuffixWidth(Math.round(suffixRef.current.getBoundingClientRect().width));
        }
    }, [prefix, suffix]);

    const affixStyle = {
        paddingLeft: prefix ? `calc(1rem + ${prefixWidth}px)` : undefined,
        paddingRight: suffix ? `calc(1rem + ${suffixWidth}px)` : undefined,
    };

    return (
        <div className="relative flex items-center">
            {prefix && (
                <span ref={prefixRef} className="absolute left-3 text-muted-foreground whitespace-nowrap">
                    {prefix}
                </span>
            )}
            <Input
                {...inputProps}
                className={className}
                style={{ ...inputProps.style, ...affixStyle }}
                disabled={readOnly}
            />
            {suffix && (
                <span ref={suffixRef} className="absolute right-3 text-muted-foreground whitespace-nowrap">
                    {suffix}
                </span>
            )}
        </div>
    );
}
