import { MenuItem } from 'prosemirror-menu';
import { Node, NodeSpec, NodeType } from 'prosemirror-model';
import { EditorState, NodeSelection, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import { ModalService } from '../../../../../providers/modal/modal.service';
import {
    ExternalImageAttrs,
    ExternalImageDialogComponent,
} from '../../external-image-dialog/external-image-dialog.component';
import { ContextMenuService } from '../context-menu/context-menu.service';
import { canInsert, renderClarityIcon } from '../menu/menu-common';

export const imageNode: NodeSpec = {
    inline: true,
    attrs: {
        src: {},
        alt: { default: null },
        title: { default: null },
        width: { default: null },
        height: { default: null },
        dataExternal: { default: true },
    },
    group: 'inline',
    draggable: true,
    parseDOM: [
        {
            tag: 'img[src]',
            getAttrs(dom) {
                return {
                    src: (dom as HTMLImageElement).getAttribute('src'),
                    title: (dom as HTMLImageElement).getAttribute('title'),
                    alt: (dom as HTMLImageElement).getAttribute('alt'),
                    width: (dom as HTMLImageElement).getAttribute('width'),
                    height: (dom as HTMLImageElement).getAttribute('height'),
                    dataExternal: (dom as HTMLImageElement).hasAttribute('data-external'),
                };
            },
        },
    ],
    toDOM(node) {
        const { src, alt, title, width, height, dataExternal } = node.attrs;
        return ['img', { src, alt, title, width, height, 'data-external': dataExternal }];
    },
};

export function insertImageItem(nodeType: NodeType, modalService: ModalService) {
    return new MenuItem({
        title: 'Insert image',
        label: 'Image',
        render: renderClarityIcon({ shape: 'image', label: 'Image' }),
        class: '',
        css: '',

        enable(state: EditorState) {
            return canInsert(state, nodeType);
        },
        run(state: EditorState, _, view: EditorView) {
            let attrs: ExternalImageAttrs | undefined;
            if (state.selection instanceof NodeSelection && state.selection.node.type === nodeType) {
                attrs = state.selection.node.attrs as ExternalImageAttrs;
            }
            modalService
                .fromComponent(ExternalImageDialogComponent, {
                    closable: true,
                    locals: {
                        existing: attrs,
                    },
                })
                .subscribe(result => {
                    if (result) {
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        view.dispatch(view.state.tr.replaceSelectionWith(nodeType.createAndFill(result)!));
                    }
                    view.focus();
                });
        },
    });
}

export const imageContextMenuPlugin = (contextMenuService: ContextMenuService, modalService: ModalService) =>
    new Plugin({
        view: () => ({
            update: view => {
                if (!view.hasFocus()) {
                    return;
                }
                const { doc, selection } = view.state;
                let imageNode: Node | undefined;
                let imageNodePos = 0;
                doc.nodesBetween(selection.from, selection.to, (n, pos, parent) => {
                    if (n.type.name === 'image') {
                        imageNode = n;
                        imageNodePos = pos;
                        return false;
                    }
                });
                if (imageNode) {
                    const node = view.nodeDOM(imageNodePos);
                    if (node instanceof HTMLImageElement) {
                        contextMenuService.setContextMenu({
                            ref: selection,
                            title: 'Image',
                            iconShape: 'image',
                            element: node,
                            coords: view.coordsAtPos(imageNodePos),
                            items: [
                                {
                                    enabled: true,
                                    iconShape: 'image',
                                    label: 'Image properties',
                                    onClick: () => {
                                        contextMenuService.clearContextMenu();
                                        modalService
                                            .fromComponent(ExternalImageDialogComponent, {
                                                closable: true,
                                                locals: {
                                                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                                                    existing: imageNode!.attrs as ExternalImageAttrs,
                                                },
                                            })
                                            .subscribe(result => {
                                                if (result) {
                                                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                                                    view.dispatch(
                                                        view.state.tr.replaceSelectionWith(
                                                            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                                                            imageNode!.type.createAndFill(result)!,
                                                        ),
                                                    );
                                                }
                                                view.focus();
                                            });
                                    },
                                },
                            ],
                        });
                    }
                } else {
                    contextMenuService.clearContextMenu();
                }
            },
        }),
    });
