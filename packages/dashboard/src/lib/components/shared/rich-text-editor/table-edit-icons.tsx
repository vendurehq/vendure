import { Trans } from '@lingui/react/macro';
import { Editor } from '@tiptap/react';
import { MoreHorizontalIcon, MoreVerticalIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';

export interface TableEditIconsProps {
    editor: Editor | null;
    disabled?: boolean;
}

interface TableCellPosition {
    columnIndex: number;
    rowIndex: number;
    cellRect: DOMRect | null;
    tableRect: DOMRect | null;
}

export function TableEditIcons({ editor, disabled }: Readonly<TableEditIconsProps>) {
    const [cellPosition, setCellPosition] = useState<TableCellPosition | null>(null);

    useEffect(() => {
        if (!editor) return;

        const updateCellPosition = () => {
            if (!editor.isActive('table')) {
                setCellPosition(null);
                return;
            }

            try {
                const { selection } = editor.state;
                const { $from } = selection;

                // Find the table cell node
                let cellNode = null;
                let cellPos = null;

                for (let depth = $from.depth; depth >= 0; depth--) {
                    const node = $from.node(depth);
                    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
                        cellNode = node;
                        cellPos = $from.before(depth);
                        break;
                    }
                }

                if (!cellNode || cellPos === null) {
                    setCellPosition(null);
                    return;
                }

                // Get DOM elements
                const cellDOMNode = editor.view.nodeDOM(cellPos) as HTMLElement;
                const tableDOMNode = cellDOMNode?.closest('table');

                if (!cellDOMNode || !tableDOMNode) {
                    setCellPosition(null);
                    return;
                }

                // Calculate column and row indices
                const row = cellDOMNode.closest('tr');
                const columnIndex = Array.from(row?.children || []).indexOf(cellDOMNode);
                const rowIndex = Array.from(tableDOMNode.querySelectorAll('tr')).indexOf(row!);

                setCellPosition({
                    columnIndex,
                    rowIndex,
                    cellRect: cellDOMNode.getBoundingClientRect(),
                    tableRect: tableDOMNode.getBoundingClientRect(),
                });
            } catch (error) {
                console.warn('Error calculating table cell position:', error);
                setCellPosition(null);
            }
        };

        // Update on selection change
        const handleSelectionUpdate = () => {
            updateCellPosition();
        };

        editor.on('selectionUpdate', handleSelectionUpdate);
        editor.on('transaction', handleSelectionUpdate);

        // Initial update
        updateCellPosition();

        return () => {
            editor.off('selectionUpdate', handleSelectionUpdate);
            editor.off('transaction', handleSelectionUpdate);
        };
    }, [editor]);

    if (!cellPosition || disabled) return null;

    if (!editor) return null;

    const { cellRect, tableRect } = cellPosition;

    if (!cellRect || !tableRect) return null;

    // Calculate positions for edit icons
    const columnIconTop = tableRect.top - 30;
    const columnIconLeft = cellRect.left + cellRect.width / 2 - 12;

    const rowIconTop = cellRect.top + cellRect.height / 2 - 12;
    const rowIconLeft = tableRect.left - 30;

    return (
        <>
            {/* Column edit icon */}
            <div
                style={{
                    position: 'fixed',
                    top: columnIconTop,
                    left: columnIconLeft,
                    zIndex: 1000,
                }}
            >
                <DropdownMenu>
                    <DropdownMenuTrigger render={<Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border-0"
                        />}>
                            <MoreHorizontalIcon className="h-3 w-3" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center">
                        <DropdownMenuItem
                            onClick={() => editor.chain().focus().addColumnBefore().run()}
                            disabled={!editor.can().addColumnBefore()}
                        >
                            <Trans>Add column before</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => editor.chain().focus().addColumnAfter().run()}
                            disabled={!editor.can().addColumnAfter()}
                        >
                            <Trans>Add column after</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={() => editor.chain().focus().toggleHeaderColumn().run()}
                            disabled={!editor.can().toggleHeaderColumn()}
                        >
                            <Trans>Toggle header column</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={() => editor.chain().focus().deleteColumn().run()}
                            disabled={!editor.can().deleteColumn()}
                            className="text-destructive focus:text-destructive"
                        >
                            <Trans>Delete column</Trans>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Row edit icon */}
            <div
                style={{
                    position: 'fixed',
                    top: rowIconTop,
                    left: rowIconLeft,
                    zIndex: 1000,
                }}
            >
                <DropdownMenu>
                    <DropdownMenuTrigger render={<Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border-0"
                        />}>
                            <MoreVerticalIcon className="h-3 w-3" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center">
                        <DropdownMenuItem
                            onClick={() => editor.chain().focus().addRowBefore().run()}
                            disabled={!editor.can().addRowBefore()}
                        >
                            <Trans>Add row before</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => editor.chain().focus().addRowAfter().run()}
                            disabled={!editor.can().addRowAfter()}
                        >
                            <Trans>Add row after</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={() => editor.chain().focus().toggleHeaderRow().run()}
                            disabled={!editor.can().toggleHeaderRow()}
                        >
                            <Trans>Toggle header row</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={() => editor.chain().focus().deleteRow().run()}
                            disabled={!editor.can().deleteRow()}
                            className="text-destructive focus:text-destructive"
                        >
                            <Trans>Delete row</Trans>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </>
    );
}
