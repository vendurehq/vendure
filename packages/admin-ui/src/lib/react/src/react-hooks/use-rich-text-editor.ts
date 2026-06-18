import { useEffect, useRef } from 'react';
import { Injector } from '@angular/core';

import { CreateEditorViewOptions, ProsemirrorService, ContextMenuService } from '@vendure/admin-ui/core';
import { useInjector } from './use-injector';

export interface useRichTextEditorOptions extends Omit<CreateEditorViewOptions, 'element'> {
    /**
     * @description
     * Control the DOM attributes of the editable element. May be either an object or a function going from an editor state to an object.
     * By default, the element will get a class "ProseMirror", and will have its contentEditable attribute determined by the editable prop.
     * Additional classes provided here will be added to the class. For other attributes, the value provided first (as in someProp) will be used.
     * Copied from real property description.
     */
    attributes?: Record<string, string>;
}

/**
 * @description
 * Provides access to the ProseMirror (rich text editor) instance.
 *
 * @example
 * ```ts
 * import { useRichTextEditor } from '\@vendure/admin-ui/react';
 * import React from 'react';
 *
 * export function Component() {
 *     const { ref, editor } = useRichTextEditor({
 *        attributes: { class: '' },
 *        onTextInput: (text) => console.log(text),
 *        isReadOnly: () => false,
 *     });
 *
 *     return <div className="w-full" ref={ref} />
 * }
 * ```
 *
 * @docsCategory react-hooks
 */
export const useRichTextEditor = ({ attributes, onTextInput, isReadOnly }: useRichTextEditorOptions) => {
    const injector = useInjector(Injector);
    const ref = useRef<HTMLDivElement>(null);
    const prosemirror = new ProsemirrorService(injector, useInjector(ContextMenuService));

    useEffect(() => {
        if (!ref.current) return;
        prosemirror.createEditorView({
            element: ref.current,
            isReadOnly,
            onTextInput,
        });
        const readOnly = isReadOnly();
        prosemirror.editorView.setProps({
            attributes,
            editable: readOnly ? () => false : () => true,
        });
        return () => {
            prosemirror.destroy();
        };
    }, [ref.current]);

    return { ref, editor: prosemirror };
};
