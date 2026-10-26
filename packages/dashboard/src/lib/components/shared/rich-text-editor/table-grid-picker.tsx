import { Trans, useLingui } from '@lingui/react/macro';
import { Editor } from '@tiptap/react';
import { TableIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip.js';

const MAX_ROWS = 6;
const MAX_COLS = 8;

export interface TableGridPickerProps {
    editor: Editor;
    disabled?: boolean;
}

export function TableGridPicker({ editor, disabled }: Readonly<TableGridPickerProps>) {
    const { t } = useLingui();
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState<{ rows: number; cols: number }>({ rows: 0, cols: 0 });

    const insertTable = (rows: number, cols: number) => {
        editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
        setOpen(false);
    };

    return (
        <Popover
            open={open}
            onOpenChange={isOpen => {
                setOpen(isOpen);
                if (!isOpen) {
                    setHovered({ rows: 0, cols: 0 });
                }
            }}
        >
            <Tooltip>
                <TooltipTrigger
                    render={
                        <PopoverTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    aria-label={t`Insert table`}
                                    disabled={disabled}
                                />
                            }
                        />
                    }
                >
                    <TableIcon className="h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent>
                    <Trans>Insert table</Trans>
                </TooltipContent>
            </Tooltip>
            <PopoverContent className="w-auto p-2" align="start">
                <div className="flex flex-col gap-1.5">
                    <div
                        className="grid gap-0.5"
                        style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 1fr)` }}
                        onMouseLeave={() => setHovered({ rows: 0, cols: 0 })}
                        role="grid"
                        aria-label={t`Table size`}
                    >
                        {Array.from({ length: MAX_ROWS * MAX_COLS }, (_, index) => {
                            const row = Math.floor(index / MAX_COLS) + 1;
                            const col = (index % MAX_COLS) + 1;
                            const isHighlighted = row <= hovered.rows && col <= hovered.cols;
                            return (
                                <button
                                    key={index}
                                    type="button"
                                    className={`h-4 w-4 rounded-xs border transition-colors ${
                                        isHighlighted ? 'border-primary bg-primary/20' : 'border-border bg-muted/40'
                                    }`}
                                    onMouseEnter={() => setHovered({ rows: row, cols: col })}
                                    onFocus={() => setHovered({ rows: row, cols: col })}
                                    onClick={() => insertTable(row, col)}
                                    aria-label={t`Insert ${row} by ${col} table`}
                                />
                            );
                        })}
                    </div>
                    <div className="text-center text-xs text-muted-foreground">
                        {hovered.rows > 0 ? (
                            `${hovered.rows} × ${hovered.cols}`
                        ) : (
                            <Trans>Select table size</Trans>
                        )}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
