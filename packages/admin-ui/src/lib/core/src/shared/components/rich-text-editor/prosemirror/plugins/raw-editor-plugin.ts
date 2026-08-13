import { DOMParser, DOMSerializer, Node } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';

import { ModalService } from '../../../../../providers/modal/modal.service';
import { RawHtmlDialogComponent } from '../../raw-html-dialog/raw-html-dialog.component';
import { ContextMenuService } from '../context-menu/context-menu.service';

/**
 * Implements editing of raw HTML for the selected node in the editor.
 */
export const rawEditorPlugin = (contextMenuService: ContextMenuService, modalService: ModalService) =>
    new Plugin({
        view: _view => {
            const domParser = DOMParser.fromSchema(_view.state.schema);
            const domSerializer = DOMSerializer.fromSchema(_view.state.schema);
            return {
                update: view => {
                    if (!view.hasFocus()) {
                        return;
                    }
                    let topLevelNode: Node | undefined;
                    const { doc, selection } = view.state;
                    let topLevelNodePos = 0;
                    doc.nodesBetween(selection.from, selection.to, (n, pos, parent) => {
                        if (parent === doc) {
                            topLevelNode = n;
                            topLevelNodePos = pos;
                            return false;
                        }
                    });
                    if (topLevelNode) {
                        const node = view.nodeDOM(topLevelNodePos);
                        if (node instanceof HTMLElement) {
                            contextMenuService.setContextMenu({
                                ref: selection,
                                title: '',
                                // iconShape: 'ellipsis-vertical',
                                element: node,
                                coords: view.coordsAtPos(topLevelNodePos),
                                items: [
                                    {
                                        enabled: true,
                                        iconShape: 'code',
                                        label: 'Edit HTML',
                                        onClick: () => {
                                            contextMenuService.clearContextMenu();
                                            const element = domSerializer.serializeNode(
                                                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                                                topLevelNode!,
                                            ) as HTMLElement;
                                            modalService
                                                .fromComponent(RawHtmlDialogComponent, {
                                                    size: 'xl',
                                                    locals: {
                                                        html: element.outerHTML,
                                                    },
                                                })
                                                .subscribe(result => {
                                                    if (result) {
                                                        const domNode = htmlToDomNode(
                                                            result,
                                                            topLevelNode?.isLeaf ? undefined : node,
                                                        );
                                                        if (domNode) {
                                                            let tr = view.state.tr;
                                                            const parsedNodeSlice = domParser.parse(domNode);
                                                            try {
                                                                tr = tr.replaceRangeWith(
                                                                    topLevelNodePos,
                                                                    topLevelNodePos +
                                                                        (topLevelNode?.nodeSize ?? 0),
                                                                    parsedNodeSlice,
                                                                );
                                                            } catch (err: any) {
                                                                // eslint-disable-next-line no-console
                                                                console.error(err);
                                                            }
                                                            view.dispatch(tr);
                                                            view.focus();
                                                        }
                                                    }
                                                });
                                        },
                                    },
                                ],
                            });
                        }
                    }
                },
            };
        },
    });

function htmlToDomNode(html: string, wrapInParent?: HTMLElement) {
    html = `${html.trim()}`;
    const template = document.createElement('template');
    if (wrapInParent) {
        const parentClone = wrapInParent.cloneNode(false) as HTMLElement;
        parentClone.innerHTML = html;
        template.content.appendChild(parentClone);
    } else {
        const parent = document.createElement('p');
        parent.innerHTML = html;
        template.content.appendChild(parent);
    }
    return template.content.firstChild;
}
