import { CombinationModeInput } from '@/vdb/components/data-input/combination-mode-input.js';
import { DefaultRelationInput } from '@/vdb/components/data-input/default-relation-input.js';
import {
    CustomerGroupInput,
    FacetValueInput,
    MoneyInput,
    NumberInput,
    ProductMultiInput,
    RichTextInput,
    SelectWithOptions,
} from '@/vdb/components/data-input/index.js';
import { PasswordFormInput } from '@/vdb/components/data-input/password-form-input.js';
import { TextInput } from '@/vdb/components/data-input/text-input.js';
import { TextareaInput } from '@/vdb/components/data-input/textarea-input.js';
import { DashboardFormComponent } from '@/vdb/framework/form-engine/form-engine-types.js';
import { globalRegistry } from '../registry/global-registry.js';

globalRegistry.register('inputComponents', new Map<string, DashboardFormComponent>());

const DefaultProductInput: DashboardFormComponent = props => (
    <DefaultRelationInput {...props} entityType="ProductVariant" />
);
DefaultProductInput.metadata = { isListInput: 'dynamic' };

// Register built-in input components
const inputComponents = globalRegistry.get('inputComponents');
inputComponents.set('facet-value-input', FacetValueInput);
inputComponents.set('combination-mode-input', CombinationModeInput);
inputComponents.set('product-multi-input', ProductMultiInput);
inputComponents.set('currency-form-input', MoneyInput);
inputComponents.set('customer-group-form-input', CustomerGroupInput);
inputComponents.set('facet-value-form-input', FacetValueInput);
inputComponents.set('json-editor-form-input', TextareaInput);
inputComponents.set('textarea-form-input', TextareaInput);
inputComponents.set('html-editor-form-input', RichTextInput);
inputComponents.set('rich-text-form-input', RichTextInput);
inputComponents.set('password-form-input', PasswordFormInput);
inputComponents.set('product-selector-form-input', DefaultProductInput);
inputComponents.set('relation-form-input', DefaultRelationInput);
inputComponents.set('select-form-input', SelectWithOptions);
inputComponents.set('product-multi-form-input', ProductMultiInput);
inputComponents.set('combination-mode-form-input', CombinationModeInput);
inputComponents.set('number-form-input', NumberInput);
inputComponents.set('text-form-input', TextInput);

export function getInputComponent(id: string | undefined): DashboardFormComponent | undefined {
    if (!id) {
        return undefined;
    }
    const inputComponent = globalRegistry.get('inputComponents').get(id);
    return inputComponent;
}

/**
 * @description
 * Generates a component key based on the targeting properties.
 * Follows the existing pattern: pageId_blockId_fieldName
 */
export function generateInputComponentKey(pageId: string, blockId: string, field: string): string {
    return `${pageId}_${blockId}_${field}`;
}

export function addInputComponent({
    pageId,
    blockId,
    field,
    component,
}: {
    pageId: string;
    blockId: string;
    field: string;
    component: DashboardFormComponent;
}) {
    const inputComponents = globalRegistry.get('inputComponents');

    // Generate the key using the helper function
    const key = generateInputComponentKey(pageId, blockId, field);

    if (inputComponents.has(key)) {
        // eslint-disable-next-line no-console
        console.warn(`Input component with key "${key}" is already registered and will be overwritten.`);
    }
    inputComponents.set(key, component);
}

export function addCustomFieldInputComponent({
    id,
    component,
}: {
    id: string;
    component: DashboardFormComponent;
}) {
    const inputComponents = globalRegistry.get('inputComponents');

    if (inputComponents.has(id)) {
        // eslint-disable-next-line no-console
        console.warn(`Input component with key "${id}" is already registered and will be overwritten.`);
    }
    inputComponents.set(id, component);
}
