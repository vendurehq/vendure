import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isFieldDisabled } from '@/vdb/framework/form-engine/utils.js';
import { useMemo } from 'react';
import { RichTextEditor } from '../shared/rich-text-editor/rich-text-editor.js';

/**
 * @description
 * A component for displaying a rich text editor. Internally uses ProseMirror (rich text editor) under the hood.
 *
 * @docsCategory form-components
 * @docsPage RichTextInput
 */
export function RichTextInput({
    value,
    onChange,
    fieldDef,
    disabled,
    placeholder,
}: Readonly<DashboardFormComponentProps & { placeholder?: string }>) {
    const readOnly = isFieldDisabled(disabled, fieldDef);
    const strippedPlaceholder = useMemo(
        () =>
            placeholder
                ? new DOMParser().parseFromString(placeholder, 'text/html').body.textContent?.trim() || undefined
                : undefined,
        [placeholder],
    );

    return <RichTextEditor value={value} onChange={onChange} disabled={readOnly} placeholder={strippedPlaceholder} />;
}

RichTextInput.metadata = {
    isFullWidth: true,
};
