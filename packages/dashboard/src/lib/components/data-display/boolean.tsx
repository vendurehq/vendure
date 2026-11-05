import { useLingui } from '@lingui/react/macro';
import { CheckIcon, XIcon } from 'lucide-react';
import React from 'react';
import { StatusBadge } from '../ui/status-badge.js';

export function BooleanDisplayCheckbox({ value }: Readonly<{ value: boolean }>) {
    return value ? <CheckIcon className="opacity-70" /> : <XIcon className="opacity-70" />;
}

export function BooleanDisplayYesNoBadge({ value }: Readonly<{ value: boolean }>) {
    const { t } = useLingui();
    return <StatusBadge tone={value ? 'success' : 'neutral'}>{value ? t`Yes` : t`No`}</StatusBadge>;
}

/**
 * A `false` value shows a badge ("Disabled" by default). A `true` value shows no badge, only a
 * label for screen readers ("Enabled" by default). In a column named "Enabled", a visible
 * "Enabled" badge in each row only repeats the header.
 */
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
    if (value) {
        return <span className="sr-only">{labelTrue ?? t`Enabled`}</span>;
    }
    return <StatusBadge tone="neutral">{labelFalse ?? t`Disabled`}</StatusBadge>;
}
