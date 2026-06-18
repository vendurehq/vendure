/**
 * Test page for verifying that all built-in form input components
 * correctly handle the `disabled` prop.
 *
 * This page is registered as a dashboard extension route by
 * FormInputsTestPlugin and used by E2E tests (issue #4424).
 */
import {
    Button,
    ConfigurableFieldDef,
    Field,
    FieldLabel,
    Form,
    FormControlAdapter,
    FullWidthPageBlock,
    Page,
    PageLayout,
    PageTitle,
} from '@vendure/dashboard';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

// Simulated custom field definitions. They must have a `readonly` property
// so that `isCustomFieldConfig()` recognises them.
const fieldDefs: Record<string, ConfigurableFieldDef> = {
    textField: {
        name: 'textField',
        type: 'string',
        readonly: false,
        list: false,
        nullable: false,
        label: [{ languageCode: 'en', value: 'Text Field' }],
        description: null,
        ui: null,
        internal: false,
        requiresPermission: null,
    } as unknown as ConfigurableFieldDef,

    numberField: {
        name: 'numberField',
        type: 'int',
        readonly: false,
        list: false,
        nullable: false,
        label: [{ languageCode: 'en', value: 'Number Field' }],
        description: null,
        ui: null,
        internal: false,
        requiresPermission: null,
    } as unknown as ConfigurableFieldDef,

    booleanField: {
        name: 'booleanField',
        type: 'boolean',
        readonly: false,
        list: false,
        nullable: false,
        label: [{ languageCode: 'en', value: 'Boolean Field' }],
        description: null,
        ui: null,
        internal: false,
        requiresPermission: null,
    } as unknown as ConfigurableFieldDef,

    datetimeField: {
        name: 'datetimeField',
        type: 'datetime',
        readonly: false,
        list: false,
        nullable: false,
        label: [{ languageCode: 'en', value: 'DateTime Field' }],
        description: null,
        ui: null,
        internal: false,
        requiresPermission: null,
    } as unknown as ConfigurableFieldDef,

    selectField: {
        name: 'selectField',
        type: 'string',
        readonly: false,
        list: false,
        nullable: false,
        label: [{ languageCode: 'en', value: 'Select Field' }],
        description: null,
        ui: null,
        internal: false,
        requiresPermission: null,
        options: [
            { value: 'low', label: null },
            { value: 'medium', label: null },
            { value: 'high', label: null },
        ],
    } as unknown as ConfigurableFieldDef,
};

export function FormInputsTestPage() {
    const [disabled, setDisabled] = useState(false);
    const form = useForm({
        defaultValues: {
            textField: 'hello world',
            numberField: 42,
            booleanField: true,
            datetimeField: '2025-06-15T10:30:00.000Z',
            selectField: 'medium',
        },
    });

    return (
        <Page pageId="form-inputs-test">
            <PageTitle>Form Inputs Test</PageTitle>
            <PageLayout>
                <FullWidthPageBlock blockId="form-inputs-test">
                    <div className="max-w-xl space-y-6 p-4">
                        <Button
                            data-testid="toggle-disabled"
                            variant={disabled ? 'default' : 'outline'}
                            onClick={() => setDisabled(d => !d)}
                        >
                            {disabled ? 'Inputs are disabled' : 'Inputs are enabled'}
                        </Button>

                        <Form {...form}>
                            <div className="space-y-6">
                                {Object.entries(fieldDefs).map(([name, fieldDef]) => (
                                    <Controller
                                        key={name}
                                        control={form.control}
                                        name={name as keyof typeof form.formState.defaultValues}
                                        disabled={disabled}
                                        render={({ field }) => (
                                            <Field>
                                                <FieldLabel>
                                                    {(fieldDef as any).label?.[0]?.value ?? name}
                                                </FieldLabel>
                                                <FormControlAdapter
                                                    fieldDef={fieldDef}
                                                    field={field}
                                                    valueMode="native"
                                                />
                                            </Field>
                                        )}
                                    />
                                ))}
                            </div>
                        </Form>
                    </div>
                </FullWidthPageBlock>
            </PageLayout>
        </Page>
    );
}
