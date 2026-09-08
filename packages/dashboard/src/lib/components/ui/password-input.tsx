import { useLingui } from '@lingui/react/macro';
import { PasswordInput as BasePasswordInput } from '@vendure-io/ui/components/molecules/password-input';
import * as React from 'react';

type PasswordInputProps = Readonly<Omit<React.ComponentProps<'input'>, 'type'>>;

function PasswordInput(props: PasswordInputProps) {
    const { t } = useLingui();

    return (
        <BasePasswordInput
            showPasswordLabel={t`Show password`}
            hidePasswordLabel={t`Hide password`}
            {...props}
        />
    );
}

export { PasswordInput };
