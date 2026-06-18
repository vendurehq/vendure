import { Injectable, Injector } from '@angular/core';
import { baseKeymap } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { DOMParser, DOMSerializer, Schema } from 'prosemirror-model';
import { schema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { EditorState, Plugin } from 'prosemirror-state';
import { columnResizing, fixTables, tableEditing } from 'prosemirror-tables';
import { EditorView } from 'prosemirror-view';
import { Observable } from 'rxjs';

import { ModalService } from '../../../../providers/modal/modal.service';

import { ContextMenuService } from './context-menu/context-menu.service';
import { iframeNode, iframeNodeView, linkMark } from './custom-nodes';
import { buildInputRules } from './inputrules';
import { buildKeymap } from './keymap';
import { customMenuPlugin } from './menu/menu-plugin';
import { imageContextMenuPlugin, imageNode } from './plugins/image-plugin';
import { linkSelectPlugin } from './plugins/link-select-plugin';
import { rawEditorPlugin } from './plugins/raw-editor-plugin';
import { getTableNodes, tableContextMenuPlugin } from './plugins/tables-plugin';
import { SetupOptions } from './types';

export interface CreateEditorViewOptions {
    onTextInput: (content: string) => void;
    element: HTMLElement;
    isReadOnly: () => boolean;
}

@Injectable()
export class ProsemirrorService {
    editorView: EditorView;

    // Mix the nodes from prosemirror-schema-list into the basic schema to
    // create a schema with list support.
    private mySchema = new Schema({
        nodes: addListNodes(schema.spec.nodes, 'paragraph block*', 'block')
            .append(getTableNodes() as any)
            .update('image', imageNode)
            .addToEnd('iframe', iframeNode),
        marks: schema.spec.marks.update('link', linkMark),
    });
    private enabled = true;
    /**
     * This is a Document used for processing incoming text. It ensures that malicious HTML is not executed by the
     * actual document that is attached to the browser DOM, which could cause XSS attacks.
     */
    private detachedDoc: Document | null = null;

    constructor(
        private injector: Injector,
        private contextMenuService: ContextMenuService,
    ) {}

    contextMenuItems$: Observable<string>;

    createEditorView(options: CreateEditorViewOptions) {
        this.editorView = new EditorView(options.element, {
            state: this.getStateFromText(''),
            dispatchTransaction: tr => {
                if (!this.enabled) {
                    return;
                }
                this.editorView.updateState(this.editorView.state.apply(tr));
                if (tr.docChanged) {
                    const content = this.getTextFromState(this.editorView.state);
                    options.onTextInput(content);
                }
            },
            editable: () => options.isReadOnly(),
            handleDOMEvents: {
                focus: view => {
                    this.contextMenuService.setVisibility(true);
                },
                blur: view => {
                    this.contextMenuService.setVisibility(false);
                },
            },
            nodeViews: {
                iframe: iframeNodeView,
            },
        });
    }

    update(text: string) {
        if (this.editorView) {
            const currentText = this.getTextFromState(this.editorView.state);
            if (text !== currentText) {
                let state = this.getStateFromText(text);
                if (document.body.contains(this.editorView.dom)) {
                    const fix = fixTables(state);
                    if (fix) {
                        state = state.apply(fix.setMeta('addToHistory', false));
                    }
                    this.editorView.updateState(state);
                }
            }
        }
    }

    destroy() {
        if (this.editorView) {
            this.editorView.destroy();
        }
    }

    setEnabled(enabled: boolean) {
        if (this.editorView) {
            this.enabled = enabled;
            // Updating the state causes ProseMirror to check the
            // `editable()` function from the contructor config object
            // newly.
            this.editorView.updateState(this.editorView.state);
        }
    }

    private getStateFromText(text: string | null | undefined): EditorState {
        const doc = this.getDetachedDoc();
        const div = doc.createElement('div');
        div.innerHTML = text ?? '';
        return EditorState.create({
            doc: DOMParser.fromSchema(this.mySchema).parse(div),
            plugins: this.configurePlugins({ schema: this.mySchema, floatingMenu: false }),
        });
    }

    private getTextFromState(state: EditorState): string {
        const doc = this.getDetachedDoc();
        const div = doc.createElement('div');
        const fragment = DOMSerializer.fromSchema(this.mySchema).serializeFragment(state.doc.content);

        div.appendChild(fragment);

        return div.innerHTML;
    }

    private configurePlugins(options: SetupOptions) {
        const plugins = [
            buildInputRules(options.schema),
            keymap(buildKeymap(options.schema, options.mapKeys)),
            keymap(baseKeymap),
            dropCursor(),
            gapCursor(),
            linkSelectPlugin,
            columnResizing({}),
            tableEditing({ allowTableNodeSelection: true }),
            tableContextMenuPlugin(this.contextMenuService),
            imageContextMenuPlugin(this.contextMenuService, this.injector.get(ModalService)),
            rawEditorPlugin(this.contextMenuService, this.injector.get(ModalService)),
            customMenuPlugin({
                floatingMenu: options.floatingMenu,
                injector: this.injector,
                schema: options.schema,
            }),
        ];
        if (options.history !== false) {
            plugins.push(history());
        }

        return plugins.concat(
            new Plugin({
                props: {
                    attributes: { class: 'vdr-prosemirror' },
                },
            }),
        );
    }

    private getDetachedDoc() {
        if (!this.detachedDoc) {
            this.detachedDoc = document.implementation.createHTMLDocument();
        }
        return this.detachedDoc;
    }
}
