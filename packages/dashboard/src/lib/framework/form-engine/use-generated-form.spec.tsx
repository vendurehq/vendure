import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { FieldInfo } from '../document-introspection/get-document-structure.js';
import { useGeneratedForm } from './use-generated-form.js';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../hooks/use-channel.js', () => ({
    useChannel: () => ({ activeChannel: { defaultLanguageCode: 'en' } }),
}));

vi.mock('../../hooks/use-server-config.js', () => ({
    useServerConfig: () => ({ availableLanguages: ['en'] }),
}));

// Mirrors `CreateStockLocationInput`: every custom field is nullable in the GraphQL input type,
// whatever its `nullable` setting in the custom field config.
const inputFields: FieldInfo[] = [
    { name: 'name', type: 'String', nullable: false, list: false, isPaginatedList: false, isScalar: true },
    {
        name: 'customFields',
        type: 'CreateStockLocationCustomFieldsInput',
        nullable: true,
        list: false,
        isPaginatedList: false,
        isScalar: false,
        typeInfo: [
            {
                name: 'defaultMinStock',
                type: 'Int',
                nullable: true,
                list: false,
                isPaginatedList: false,
                isScalar: true,
            },
        ],
    },
];

vi.mock('virtual:admin-api-schema', () => {
    return import('../document-introspection/testing-utils.js').then(m => m.getMockSchemaInfo());
});

vi.mock('../document-introspection/get-document-structure.js', async importOriginal => ({
    ...(await importOriginal<object>()),
    getOperationVariablesFields: () => inputFields,
}));

// The document is only read through the mocked `getOperationVariablesFields` above.
const createDocument = {} as any;

const customFieldConfig = [{ name: 'defaultMinStock', type: 'int', nullable: false }] as any;

async function renderForm(initialEntity?: Record<string, any>, fieldConfig = customFieldConfig) {
    let form: ReturnType<typeof useGeneratedForm>['form'] | undefined;
    let isValid: boolean | undefined;
    let isDirty: boolean | undefined;
    let setEntity: (entity: Record<string, any>) => void = () => undefined;
    function Probe() {
        const [entity, set] = useState(initialEntity);
        setEntity = set;
        form = useGeneratedForm({
            document: createDocument,
            varName: 'input',
            entity,
            customFieldConfig: fieldConfig,
            setValues: e => ({ name: e.name, customFields: e.customFields }),
        }).form;
        isValid = form.formState.isValid;
        isDirty = form.formState.isDirty;
        return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => {
        root.render(createElement(Probe));
    });
    return {
        getForm: () => form as NonNullable<typeof form>,
        getIsValid: () => isValid,
        getIsDirty: () => isDirty,
        setEntity: (entity: Record<string, any>) => act(async () => setEntity(entity)),
        unmount: () => act(() => root.unmount()),
    };
}

const existingStockLocation = { id: '1', name: 'Warehouse', customFields: { defaultMinStock: 5 } };

// #5241: a nullable: false int custom field must not leave a create form invalid at mount
describe('useGeneratedForm with a nullable: false custom field', () => {
    // #5442 — show the default before save, without marking an untouched form dirty.
    it('prefills the configured default on create', async () => {
        const config = [
            { ...customFieldConfig[0], defaultValue: 1250, ui: { component: 'currency-form-input' } },
        ];
        const { getForm, getIsDirty, unmount } = await renderForm(undefined, config);
        expect(getForm().getValues('customFields.defaultMinStock' as any)).toBe(1250);
        expect(getIsDirty()).toBe(false);
        unmount();
    });

    it('keeps a saved value instead of the configured default', async () => {
        const config = [{ ...customFieldConfig[0], defaultValue: 12 }];
        const { getForm, unmount } = await renderForm(
            { ...existingStockLocation, customFields: { defaultMinStock: 0 } },
            config,
        );
        expect(getForm().getValues('customFields.defaultMinStock' as any)).toBe(0);
        unmount();
    });

    it('create form is valid once the required built-in fields are filled', async () => {
        const { getForm, getIsValid, unmount } = await renderForm(undefined);
        await act(async () => {
            getForm().setValue('name', 'Warehouse', { shouldValidate: true });
        });
        expect(getIsValid()).toBe(true);
        let valid: boolean | undefined;
        await act(async () => {
            valid = await getForm().trigger();
        });
        expect(valid).toBe(true);
        unmount();
    });

    it('update form still rejects a cleared value', async () => {
        const { getForm, getIsValid, unmount } = await renderForm(existingStockLocation);
        expect(getIsValid()).toBe(true);
        await act(async () => {
            getForm().setValue('customFields.defaultMinStock' as any, null, { shouldValidate: true });
        });
        expect(getIsValid()).toBe(false);
        unmount();
    });

    // `useGeneratedForm` is public, and an extension may pass an entity loaded after the first render.
    it('switches to the update schema when the entity arrives after the first render', async () => {
        const { getForm, setEntity, unmount } = await renderForm(undefined);
        let validBefore: boolean | undefined;
        await act(async () => {
            validBefore = await getForm().trigger('customFields.defaultMinStock' as any);
        });
        expect(validBefore).toBe(true);
        await setEntity(existingStockLocation);
        expect(getForm().getValues('customFields.defaultMinStock' as any)).toBe(5);
        await act(async () => {
            getForm().setValue('customFields.defaultMinStock' as any, null);
        });
        let validAfter: boolean | undefined;
        await act(async () => {
            validAfter = await getForm().trigger();
        });
        expect(validAfter).toBe(false);
        unmount();
    });
});
