import { ConfigurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { FormControlAdapter } from '../../framework/form-engine/form-control-adapter.js';

export interface ConfigurableOperationArgInputProps {
    definition: ConfigurableOperationDefFragment['args'][number];
    readOnly?: boolean;
    value: string;
    onChange: (value: any) => void;
}

export function ConfigurableOperationArgInput({
    definition,
    value,
    onChange,
}: Readonly<ConfigurableOperationArgInputProps>) {
    return (
        <FormControlAdapter
            fieldDef={definition}
            field={{
                value,
                onChange,
                onBlur: () => {},
                name: definition.name,
                ref: () => {},
            }}
            valueMode="json-string"
        />
    );
}
