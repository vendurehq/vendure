import { Editor } from '@tiptap/react';
import { Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../ui/button.js';

export interface TableDeleteMenuProps {
    editor: Editor | null;
    disabled?: boolean;
}

export function TableDeleteMenu({ editor, disabled }: Readonly<TableDeleteMenuProps>) {
    const [tableRect, setTableRect] = useState<DOMRect | null>(null);

    useEffect(() => {
        if (!editor) return;

        const updateTablePosition = () => {
            if (!editor.isActive('table')) {
                setTableRect(null);
                return;
            }

            try {
                const { selection } = editor.state;
                const { $from } = selection;

                // Find the table cell node
                let cellPos = null;

                for (let depth = $from.depth; depth >= 0; depth--) {
                    const node = $from.node(depth);
                    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
                        cellPos = $from.before(depth);
                        break;
                    }
                }

                if (cellPos === null) {
                    setTableRect(null);
                    return;
                }

                // Get DOM elements
                const cellDOMNode = editor.view.nodeDOM(cellPos) as HTMLElement;
                const tableDOMNode = cellDOMNode?.closest('table');

                if (!tableDOMNode) {
                    setTableRect(null);
                    return;
                }

                setTableRect(tableDOMNode.getBoundingClientRect());
            } catch (error) {
                console.warn('Error calculating table position:', error);
                setTableRect(null);
            }
        };

        // Update on selection change
        const handleSelectionUpdate = () => {
            updateTablePosition();
        };

        editor.on('selectionUpdate', handleSelectionUpdate);
        editor.on('transaction', handleSelectionUpdate);

        // Initial update
        updateTablePosition();

        return () => {
            editor.off('selectionUpdate', handleSelectionUpdate);
            editor.off('transaction', handleSelectionUpdate);
        };
    }, [editor]);

    if (!tableRect || disabled || !editor) return null;

    // Position at bottom right of table
    const iconTop = tableRect.bottom - 30;
    const iconLeft = tableRect.right - 30;

    return (
        <div
            style={{
                position: 'fixed',
                top: iconTop,
                left: iconLeft,
                zIndex: 1000,
            }}
        >
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => editor.chain().focus().deleteTable().run()}
                disabled={disabled || !editor.can().deleteTable()}
                className="h-6 w-6 p-0 bg-background hover:bg-destructive/10 text-destructive hover:text-destructive"
                title="Delete Table"
            >
                <Trash2Icon className="h-3 w-3" />
            </Button>
        </div>
    );
}
