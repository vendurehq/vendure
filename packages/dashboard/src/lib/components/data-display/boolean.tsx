import { useLingui } from '@lingui/react/macro';
import { CheckIcon, XIcon } from 'lucide-react';
import React from 'react';
import { StatusBadge } from '../ui/status-badge.js';

export function BooleanDisplayCheckbox({ value }: Readonly<{ value: boolean }>) {
    return value ? <CheckIcon className="opacity-70" /> : <XIcon className="opacity-70" />;
}

// Accent rationing: `true` is the expected default (e.g. an enabled product),
// so it renders calm; `false` is the exception worth spotting in a list, so it
// carries the visual weight (`critical` renders via the destructive tokens).
export function BooleanDisplayBadge({
    value,
    labelTrue,
    labelFalse,
}: {
    value: boolean;
    labelTrue?: string | React.ReactNode;
    labelFalse?: string | React.ReactNode;
}) {
    const { t } = useLingui();
    return (
        <StatusBadge tone={value ? 'neutral' : 'critical'}>
            {value ? (labelTrue ?? t`Enabled`) : (labelFalse ?? t`Disabled`)}
        </StatusBadge>
    );
}
