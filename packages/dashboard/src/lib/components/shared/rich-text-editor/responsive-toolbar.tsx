import { useLingui } from '@lingui/react/macro';
import { Editor, useEditorState } from '@tiptap/react';
import {
    BoldIcon,
    CodeIcon,
    ImageIcon,
    ItalicIcon,
    LinkIcon,
    ListIcon,
    ListOrderedIcon,
    LucideIcon,
    MinusIcon,
    MoreHorizontalIcon,
    QuoteIcon,
    Redo2Icon,
    RemoveFormattingIcon,
    SquareCodeIcon,
    StrikethroughIcon,
    TableIcon,
    UnderlineIcon,
    Undo2Icon,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../../ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { ImageDialog } from './image-dialog.js';
import { TableGridPicker } from './table-grid-picker.js';
import { ToolbarButton, formatShortcut } from './toolbar-button.js';

export interface ResponsiveToolbarProps {
    editor: Editor | null;
    disabled?: boolean;
    onRequestLinkEdit: () => void;
}

interface ToolbarItem {
    id: string;
    /** Items with the same group are rendered together, separated from other groups */
    group: number;
    label: string;
    shortcut?: string;
    icon: LucideIcon;
    isActive?: boolean;
    disabled?: boolean;
    action: () => void;
    /** Custom renderer for the visible toolbar (e.g. the table grid picker) */
    renderVisible?: () => React.ReactNode;
}

// Approximate widths used to decide how many buttons fit before overflowing
const ITEM_WIDTH = 36;
const SEPARATOR_WIDTH = 13;
const HEADING_SELECT_WIDTH = 138;
const OVERFLOW_BUTTON_WIDTH = 44;
const TOOLBAR_PADDING = 16;

const HEADING_ITEM_CLASSES: Record<string, string> = {
    h1: 'text-xl font-bold',
    h2: 'text-lg font-semibold',
    h3: 'text-base font-semibold',
    h4: 'text-sm font-semibold',
    h5: 'text-xs font-semibold',
    h6: 'text-xs font-semibold',
};

export function ResponsiveToolbar({ editor, disabled, onRequestLinkEdit }: Readonly<ResponsiveToolbarProps>) {
    const { t } = useLingui();
    const [imageDialogOpen, setImageDialogOpen] = useState(false);
    const [visibleCount, setVisibleCount] = useState(Infinity);
    const toolbarRef = useRef<HTMLDivElement>(null);

    const editorState = useEditorState({
        editor,
        selector: context => {
            if (context.editor == null) {
                return;
            }
            return {
                isBold: context.editor.isActive('bold'),
                isItalic: context.editor.isActive('italic'),
                isUnderline: context.editor.isActive('underline'),
                isStrike: context.editor.isActive('strike'),
                isCode: context.editor.isActive('code'),
                isBulletList: context.editor.isActive('bulletList'),
                isOrderedList: context.editor.isActive('orderedList'),
                isBlockquote: context.editor.isActive('blockquote'),
                isCodeBlock: context.editor.isActive('codeBlock'),
                isLink: context.editor.isActive('link'),
                isImage: context.editor.isActive('image'),
                canSetLink: !context.editor.state.selection.empty || context.editor.isActive('link'),
                canUndo: context.editor.can().undo(),
                canRedo: context.editor.can().redo(),
                canInsertTable: context.editor.can().insertTable(),
            };
        },
    });

    const handleHeadingChange = useCallback(
        (value: string) => {
            if (!editor) return;
            if (value === 'paragraph') {
                editor.chain().focus().setParagraph().run();
            } else {
                const level = Number.parseInt(value.replace('h', '')) as 1 | 2 | 3 | 4 | 5 | 6;
                editor.chain().focus().toggleHeading({ level }).run();
            }
        },
        [editor],
    );

    const getCurrentHeading = useCallback(() => {
        if (!editor) return 'paragraph';
        for (let level = 1; level <= 6; level++) {
            if (editor.isActive('heading', { level })) return `h${level}`;
        }
        return 'paragraph';
    }, [editor]);

    const headingItems = useMemo(
        () => ({
            paragraph: t`Normal`,
            h1: t`Heading 1`,
            h2: t`Heading 2`,
            h3: t`Heading 3`,
            h4: t`Heading 4`,
            h5: t`Heading 5`,
            h6: t`Heading 6`,
        }),
        [t],
    );

    const toolbarItems: ToolbarItem[] = useMemo(() => {
        if (!editor || !editorState) return [];

        return [
            {
                id: 'bold',
                group: 1,
                label: t`Bold`,
                shortcut: 'mod+B',
                icon: BoldIcon,
                isActive: editorState.isBold,
                action: () => editor.chain().focus().toggleBold().run(),
            },
            {
                id: 'italic',
                group: 1,
                label: t`Italic`,
                shortcut: 'mod+I',
                icon: ItalicIcon,
                isActive: editorState.isItalic,
                action: () => editor.chain().focus().toggleItalic().run(),
            },
            {
                id: 'underline',
                group: 1,
                label: t`Underline`,
                shortcut: 'mod+U',
                icon: UnderlineIcon,
                isActive: editorState.isUnderline,
                action: () => editor.chain().focus().toggleUnderline().run(),
            },
            {
                id: 'strike',
                group: 1,
                label: t`Strikethrough`,
                shortcut: 'mod+shift+S',
                icon: StrikethroughIcon,
                isActive: editorState.isStrike,
                action: () => editor.chain().focus().toggleStrike().run(),
            },
            {
                id: 'code',
                group: 1,
                label: t`Inline code`,
                shortcut: 'mod+E',
                icon: CodeIcon,
                isActive: editorState.isCode,
                action: () => editor.chain().focus().toggleCode().run(),
            },
            {
                id: 'bulletList',
                group: 2,
                label: t`Bullet list`,
                shortcut: 'mod+shift+8',
                icon: ListIcon,
                isActive: editorState.isBulletList,
                action: () => editor.chain().focus().toggleBulletList().run(),
            },
            {
                id: 'orderedList',
                group: 2,
                label: t`Ordered list`,
                shortcut: 'mod+shift+7',
                icon: ListOrderedIcon,
                isActive: editorState.isOrderedList,
                action: () => editor.chain().focus().toggleOrderedList().run(),
            },
            {
                id: 'blockquote',
                group: 2,
                label: t`Blockquote`,
                shortcut: 'mod+shift+B',
                icon: QuoteIcon,
                isActive: editorState.isBlockquote,
                action: () => editor.chain().focus().toggleBlockquote().run(),
            },
            {
                id: 'codeBlock',
                group: 2,
                label: t`Code block`,
                shortcut: 'mod+alt+C',
                icon: SquareCodeIcon,
                isActive: editorState.isCodeBlock,
                action: () => editor.chain().focus().toggleCodeBlock().run(),
            },
            {
                id: 'link',
                group: 3,
                label: t`Link`,
                icon: LinkIcon,
                isActive: editorState.isLink,
                disabled: !editorState.canSetLink,
                action: onRequestLinkEdit,
            },
            {
                id: 'image',
                group: 3,
                label: t`Image`,
                icon: ImageIcon,
                isActive: editorState.isImage,
                action: () => setImageDialogOpen(true),
            },
            {
                id: 'table',
                group: 3,
                label: t`Insert table`,
                icon: TableIcon,
                disabled: !editorState.canInsertTable,
                action: () =>
                    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
                renderVisible: () => (
                    <TableGridPicker
                        key="table"
                        editor={editor}
                        disabled={disabled || !editorState.canInsertTable}
                    />
                ),
            },
            {
                id: 'horizontalRule',
                group: 3,
                label: t`Horizontal rule`,
                icon: MinusIcon,
                action: () => editor.chain().focus().setHorizontalRule().run(),
            },
            {
                id: 'clearFormatting',
                group: 4,
                label: t`Clear formatting`,
                icon: RemoveFormattingIcon,
                action: () => editor.chain().focus().unsetAllMarks().clearNodes().run(),
            },
            {
                id: 'undo',
                group: 5,
                label: t`Undo`,
                shortcut: 'mod+Z',
                icon: Undo2Icon,
                disabled: !editorState.canUndo,
                action: () => editor.chain().focus().undo().run(),
            },
            {
                id: 'redo',
                group: 5,
                label: t`Redo`,
                shortcut: 'mod+shift+Z',
                icon: Redo2Icon,
                disabled: !editorState.canRedo,
                action: () => editor.chain().focus().redo().run(),
            },
        ];
    }, [editor, editorState, disabled, onRequestLinkEdit, t]);

    useEffect(() => {
        const calculateVisibleCount = () => {
            if (!toolbarRef.current) return;

            const available = toolbarRef.current.clientWidth - HEADING_SELECT_WIDTH - TOOLBAR_PADDING;
            let usedWidth = 0;
            let count = 0;

            for (let i = 0; i < toolbarItems.length; i++) {
                const isGroupBoundary = i > 0 && toolbarItems[i].group !== toolbarItems[i - 1].group;
                const itemWidth = ITEM_WIDTH + (isGroupBoundary ? SEPARATOR_WIDTH : 0);
                const reservedForOverflow = i < toolbarItems.length - 1 ? OVERFLOW_BUTTON_WIDTH : 0;

                if (usedWidth + itemWidth + reservedForOverflow > available) {
                    break;
                }
                usedWidth += itemWidth;
                count++;
            }

            setVisibleCount(count);
        };

        calculateVisibleCount();

        const resizeObserver = new ResizeObserver(calculateVisibleCount);
        if (toolbarRef.current) {
            resizeObserver.observe(toolbarRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [toolbarItems.length]);

    if (!editor) {
        return null;
    }

    const visibleItems = toolbarItems.slice(0, visibleCount);
    const overflowItems = toolbarItems.slice(visibleCount);

    return (
        <div ref={toolbarRef} className="flex items-center gap-1 border-b bg-muted/30 p-2">
            <Select
                items={headingItems}
                value={getCurrentHeading()}
                onValueChange={value => value != null && handleHeadingChange(value)}
                disabled={disabled}
            >
                <SelectTrigger size="sm" className="w-[130px] py-1" aria-label={t`Text style`}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {Object.entries(headingItems).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                            <span className={HEADING_ITEM_CLASSES[value]}>{label}</span>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {visibleItems.map((item, index) => {
                const Icon = item.icon;
                const isGroupBoundary = index > 0 && item.group !== visibleItems[index - 1].group;
                return (
                    <Fragment key={item.id}>
                        {isGroupBoundary && <div className="mx-0.5 h-5 w-px shrink-0 bg-border" />}
                        {item.renderVisible ? (
                            item.renderVisible()
                        ) : (
                            <ToolbarButton
                                label={item.label}
                                shortcut={item.shortcut}
                                isActive={item.isActive}
                                disabled={disabled || item.disabled}
                                onClick={item.action}
                            >
                                <Icon className="h-4 w-4" />
                            </ToolbarButton>
                        )}
                    </Fragment>
                );
            })}

            {overflowItems.length > 0 && (
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                aria-label={t`More formatting options`}
                                disabled={disabled}
                            />
                        }
                    >
                        <MoreHorizontalIcon className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {overflowItems.map((item, index) => {
                            const Icon = item.icon;
                            const isGroupBoundary =
                                index > 0 && item.group !== overflowItems[index - 1].group;
                            return (
                                <Fragment key={item.id}>
                                    {isGroupBoundary && <DropdownMenuSeparator />}
                                    <DropdownMenuItem
                                        onClick={item.action}
                                        disabled={disabled || item.disabled}
                                        className={item.isActive ? 'bg-accent' : ''}
                                    >
                                        <Icon className="h-4 w-4" />
                                        {item.label}
                                        {item.shortcut && (
                                            <span className="ml-auto text-xs text-muted-foreground">
                                                {formatShortcut(item.shortcut)}
                                            </span>
                                        )}
                                    </DropdownMenuItem>
                                </Fragment>
                            );
                        })}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}

            <ImageDialog editor={editor} isOpen={imageDialogOpen} onClose={() => setImageDialogOpen(false)} />
        </div>
    );
}
