import { NotificationService } from '@vendure/admin-ui/core';
import { useFormControl, ReactFormInputOptions, useInjector } from '@vendure/admin-ui/react';
import React from 'react';

export function ReactNumberInput({ readonly }: ReactFormInputOptions) {
    const { value, setFormValue } = useFormControl();
    const notificationService = useInjector(NotificationService);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = +e.target.value;
        if (val === 0) {
            notificationService.error('Cannot be zero');
        } else {
            setFormValue(val);
        }
    };
    return (
        <div>
            This is a React component!
            <input readOnly={readonly} type="number" onChange={handleChange} value={value} />
        </div>
    );
}
