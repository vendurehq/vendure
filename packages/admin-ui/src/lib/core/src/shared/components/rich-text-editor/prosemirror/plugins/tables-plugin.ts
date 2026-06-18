import { MenuElement, MenuItem } from 'prosemirror-menu';
import { Node, Schema } from 'prosemirror-model';
import { EditorState, Plugin, TextSelection, Transaction } from 'prosemirror-state';
import {
    addColumnAfter,
    addColumnBefore,
    addRowAfter,
    addRowBefore,
    deleteColumn,
    deleteRow,
    deleteTable,
    isInTable,
    mergeCells,
    splitCell,
    tableNodes,
    tableNodeTypes,
    toggleHeaderCell,
    toggleHeaderColumn,
    toggleHeaderRow,
} from 'prosemirror-tables';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { ContextMenuItem, ContextMenuService } from '../context-menu/context-menu.service';
import { buildMenuItems } from '../menu/menu';
import { renderClarityIcon } from '../menu/menu-common';

export const tableContextMenuPlugin = (contextMenuService: ContextMenuService) =>
    new Plugin({
        view: () => ({
            update: view => {
                if (!view.hasFocus()) {
                    return;
                }
                const { doc, selection } = view.state;
                let tableNode: Node | undefined;
                let tableNodePos = 0;
                doc.nodesBetween(selection.from, selection.to, (n, pos, parent) => {
                    if (n.type.name === 'table') {
                        tableNode = n;
                        tableNodePos = pos;
                        return false;
                    }
                });
                if (tableNode) {
                    const node = view.nodeDOM(tableNodePos);
                    if (node instanceof Element) {
                        function createMenuItem(
                            label: string,
                            commandFn: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean,
                            iconClass?: string,
                        ): ContextMenuItem {
                            const enabled = commandFn(view.state);
                            return {
                                label,
                                enabled,
                                iconClass,
                                onClick: () => {
                                    contextMenuService.clearContextMenu();
                                    view.focus();
                                    commandFn(view.state, view.dispatch);
                                },
                            };
                        }
                        const separator: ContextMenuItem = {
                            label: '',
                            separator: true,
                            enabled: true,
                            onClick: () => {
                                /**/
                            },
                        };
                        contextMenuService.setContextMenu({
                            ref: selection,
                            title: 'Table',
                            iconShape: 'table',
                            element: node,
                            coords: view.coordsAtPos(tableNodePos),
                            items: [
                                createMenuItem('Insert column before', addColumnBefore, 'add-column'),
                                createMenuItem('Insert column after', addColumnAfter, 'add-column'),
                                createMenuItem('Insert row before', addRowBefore, 'add-row'),
                                createMenuItem('Insert row after', addRowAfter, 'add-row'),
                                createMenuItem('Merge cells', mergeCells),
                                createMenuItem('Split cell', splitCell),
                                separator,
                                createMenuItem('Toggle header column', toggleHeaderColumn),
                                createMenuItem('Toggle header row', toggleHeaderRow),
                                separator,
                                createMenuItem('Delete column', deleteColumn),
                                createMenuItem('Delete row', deleteRow),
                                createMenuItem('Delete table', deleteTable),
                            ],
                        });
                    }
                } else {
                    contextMenuService.clearContextMenu();
                }
            },
        }),
    });

export function getTableNodes() {
    return tableNodes({
        tableGroup: 'block',
        cellContent: 'block+',
        cellAttributes: {
            background: {
                default: null,
                getFromDOM(dom) {
                    return (dom as HTMLElement).style.backgroundColor || null;
                },
                setDOMAttr(value, attrs) {
                    if (value) {
                        attrs.style = (attrs.style || '') + `background-color: ${value};`;
                    }
                },
            },
        },
    });
}

export function getTableMenu(schema: Schema) {
    function item(
        label: string,
        cmd: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean,
        iconShape?: string,
    ) {
        return new MenuItem({
            label,
            select: cmd,
            run: cmd,
            render: iconShape ? renderClarityIcon({ shape: iconShape, label }) : undefined,
        });
    }

    function separator(): MenuElement {
        return new MenuItem({
            select: state => isInTable(state),
            run: state => {
                /**/
            },
            render: view => {
                const el = document.createElement('div');
                el.classList.add('menu-separator');
                return el;
            },
        });
    }

    return [
        item('Insert column before', addColumnBefore),
        item('Insert column after', addColumnAfter),
        item('Insert row before', addRowBefore),
        item('Insert row after', addRowAfter),
        item('Merge cells', mergeCells),
        item('Split cell', splitCell),
        separator(),
        item('Toggle header column', toggleHeaderColumn),
        item('Toggle header row', toggleHeaderRow),
        item('Toggle header cells', toggleHeaderCell),
        separator(),
        item('Delete column', deleteColumn),
        item('Delete row', deleteRow),
        item('Delete table', deleteTable),
    ];
}

export function addTable(state, dispatch, { rowsCount, colsCount, withHeaderRow, cellContent }) {
    const offset = state.tr.selection.anchor + 1;

    const nodes = createTable(state, rowsCount, colsCount, withHeaderRow, cellContent);
    const tr = state.tr.replaceSelectionWith(nodes).scrollIntoView();
    const resolvedPos = tr.doc.resolve(offset);

    tr.setSelection(TextSelection.near(resolvedPos));

    dispatch(tr);
}

function createTable(state, rowsCount, colsCount, withHeaderRow, cellContent) {
    const types = tableNodeTypes(state.schema);
    const headerCells: Node[] = [];
    const cells: Node[] = [];
    const createCell = (cellType, _cellContent) =>
        _cellContent ? cellType.createChecked(null, _cellContent) : cellType.createAndFill();

    for (let index = 0; index < colsCount; index += 1) {
        const cell = createCell(types.cell, cellContent);

        if (cell) {
            cells.push(cell);
        }

        if (withHeaderRow) {
            const headerCell = createCell(types.header_cell, cellContent);

            if (headerCell) {
                headerCells.push(headerCell);
            }
        }
    }

    const rows: Node[] = [];

    for (let index = 0; index < rowsCount; index += 1) {
        rows.push(types.row.createChecked(null, withHeaderRow && index === 0 ? headerCells : cells));
    }

    return types.table.createChecked(null, rows);
}
