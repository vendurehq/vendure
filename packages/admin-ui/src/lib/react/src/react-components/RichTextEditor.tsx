import React, {
    ChangeEvent,
    ForwardedRef,
    InputHTMLAttributes,
    forwardRef,
    useEffect,
    useState,
} from 'react';
import { ProsemirrorService } from '@vendure/admin-ui/core';
import { useRichTextEditor } from '../react-hooks/use-rich-text-editor';

export type RichTextEditorType = InputHTMLAttributes<HTMLInputElement> & {
    /**
     * @description
     * Control the DOM attributes of the editable element. May be either an object or a function going from an editor state to an object.
     * By default, the element will get a class "ProseMirror", and will have its contentEditable attribute determined by the editable prop.
     * Additional classes provided here will be added to the class. For other attributes, the value provided first (as in someProp) will be used.
     * Copied from real property description.
     */
    attributes?: Record<string, string>;
    label?: string;
    readOnly?: boolean;
    onMount?: (editor: ProsemirrorService) => void;
};

/**
 * @description
 * A rich text editor component which uses ProseMirror (rich text editor) under the hood.
 *
 * @example
 * ```ts
 * import { RichTextEditor } from '@vendure/admin-ui/react';
 * import React from 'react';
 *
 * export function MyComponent() {
 *   const onSubmit = async (e: React.FormEvent) => {
 *     e.preventDefault();
 *     const form = new FormData(e.target as HTMLFormElement);
 *     const content = form.get("content");
 *     console.log(content);
 *   };
 *
 *   return (
 *     <form className="w-full" onSubmit={onSubmit}>
 *       <RichTextEditor
 *         name="content"
 *         readOnly={false}
 *         onMount={(e) => console.log("Mounted", e)}
 *       />
 *       <button type="submit" className="btn btn-primary">
 *         Submit
 *       </button>
 *     </form>
 *   );
 * }
 * ```
 *
 * @docsCategory react-components
 */
export const RichTextEditor = forwardRef((props: RichTextEditorType, ref: ForwardedRef<HTMLInputElement>) => {
    const [data, setData] = useState<string>('');
    const { readOnly, label, ...rest } = props;
    const { ref: _ref, editor } = useRichTextEditor({
        attributes: props.attributes,
        isReadOnly: () => readOnly || false,
        onTextInput: text => {
            setData(text);
            if (props.onChange) {
                props.onChange({
                    target: { value: text },
                } as ChangeEvent<HTMLInputElement>);
            }
            if (ref && 'current' in ref && ref.current) {
                ref.current.value = text;
                const event = new Event('input', {
                    bubbles: true,
                    cancelable: true,
                });
                ref.current.dispatchEvent(event);
            }
        },
    });

    useEffect(() => {
        if (props.onMount && editor) {
            props.onMount(editor);
        }
        if (typeof props.defaultValue === 'string') {
            editor.update(props.defaultValue);
        }
    }, []);
    return (
        <>
            <div ref={_ref} {...rest}>
                {label && <label className="rich-text-label">{label}</label>}
            </div>
            <input type="hidden" value={data} ref={ref} />
        </>
    );
});

RichTextEditor.displayName = 'RichTextEditor';
