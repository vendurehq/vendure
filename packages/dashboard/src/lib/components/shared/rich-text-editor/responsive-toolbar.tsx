import { Trans } from '@lingui/react/macro';
import { Editor, useEditorState } from '@tiptap/react';
import {
    BoldIcon,
    ImageIcon,
    ItalicIcon,
    LinkIcon,
    ListIcon,
    ListOrderedIcon,
    MoreHorizontalIcon,
    QuoteIcon,
    Redo2Icon,
    StrikethroughIcon,
    TableIcon,
    Undo2Icon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { LinkDialog } from './link-dialog.js';

export interface ResponsiveToolbarProps {
    editor: Editor | null;
    disabled?: boolean;
}

interface ToolbarItem {
    id: string;
    priority: number;
    element: React.ReactNode;
    action?: () => void;
    label: string;
    isActive?: boolean;
}

export function ResponsiveToolbar({ editor, disabled }: Readonly<ResponsiveToolbarProps>) {
    const [linkDialogOpen, setLinkDialogOpen] = useState(false);
    const [imageDialogOpen, setImageDialogOpen] = useState(false);
    const [visibleItems, setVisibleItems] = useState<string[]>([]);
    const [overflowItems, setOverflowItems] = useState<string[]>([]);
    const toolbarRef = useRef<HTMLDivElement>(null);

    const editorState = useEditorState({
        editor: editor,
        selector: (context) => {
            if (context.editor == null) {
                return;
            }

            return {
                isBold: context.editor.isActive('bold'),
                isItalic: context.editor.isActive('italic'),
                isStrike: context.editor.isActive('strike'),
                isBulletList: context.editor.isActive('bulletList'),
                isOrderedList: context.editor.isActive('orderedList'),
                isLink: context.editor.isActive('link'),
                isImage: context.editor.isActive('image'),
                isBlockquote: context.editor.isActive('blockquote'),
                isTable: context.editor.isActive('table')
            }
        }
    })

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

    const headingOptions = useMemo(
        () => [
            { value: 'paragraph', label: <Trans>Normal</Trans> },
            { value: 'h1', label: <Trans>Heading 1</Trans> },
            { value: 'h2', label: <Trans>Heading 2</Trans> },
            { value: 'h3', label: <Trans>Heading 3</Trans> },
            { value: 'h4', label: <Trans>Heading 4</Trans> },
            { value: 'h5', label: <Trans>Heading 5</Trans> },
            { value: 'h6', label: <Trans>Heading 6</Trans> },
        ],
        [],
    );

    const canUndo = !!editor?.can().undo();
    const canRedo = !!editor?.can().redo();
    const canInsertTable = !!editor?.can().insertTable();

    const toolbarItems: ToolbarItem[] = useMemo(() => {
        if (!editor || !editorState) return [];

        return [
            {
                id: 'bold',
                priority: 1,
                label: 'Bold',
                isActive: editorState.isBold,
                action: () => editor.chain().focus().toggleBold().run(),
                element: (
                    <Button
                        key="bold"
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => editor.chain().focus().toggleBold().run()}
                        className={`h-8 px-2 ${editorState.isBold ? 'bg-accent' : ''}`}
                        disabled={disabled}
                    >
                        <BoldIcon className="h-4 w-4" />
                    </Button>
                ),
            },
            {
                id: 'italic',
                priority: 2,
                label: 'Italic',
                isActive: editorState.isItalic,
                action: () => editor.chain().focus().toggleItalic().run(),
                element: (
                    <Button
                        key="italic"
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => editor.chain().focus().toggleItalic().run()}
                        className={`h-8 px-2 ${editorState.isItalic ? 'bg-accent' : ''}`}
                        disabled={disabled}
                    >
                        <ItalicIcon className="h-4 w-4" />
                    </Button>
                ),
            },
            {
                id: 'strike',
                priority: 3,
                label: 'Strikethrough',
                isActive: editorState.isStrike,
                action: () => editor.chain().focus().toggleStrike().run(),
                element: (
                    <Button
                        key="strike"
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => editor.chain().focus().toggleStrike().run()}
                        className={`h-8 px-2 ${editorState.isStrike ? 'bg-accent' : ''}`}
                        disabled={disabled}
                    >
                        <StrikethroughIcon className="h-4 w-4" />
                    </Button>
                ),
            },
            {
                id: 'bulletList',
                priority: 4,
                label: 'Bullet List',
                isActive: editorState.isBulletList,
                action: () => editor.chain().focus().toggleBulletList().run(),
                element: (
                    <Button
                        key="bulletList"
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => editor.chain().focus().toggleBulletList().run()}
                        className={`h-8 px-2 ${editorState.isBulletList ? 'bg-accent' : ''}`}
                        disabled={disabled}
                    >
                        <ListIcon className="h-4 w-4" />
                    </Button>
                ),
            },
            {
                id: 'orderedList',
                priority: 5,
                label: 'Ordered List',
                isActive: editorState.isOrderedList,
                action: () => editor.chain().focus().toggleOrderedList().run(),
                element: (
                    <Button
                        key="orderedList"
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => editor.chain().focus().toggleOrderedList().run()}
                        className={`h-8 px-2 ${editorState.isOrderedList ? 'bg-accent' : ''}`}
                        disabled={disabled}
                    >
                        <ListOrderedIcon className="h-4 w-4" />
                    </Button>
                ),
            },
            {
                id: 'link',
                priority: 6,
                label: 'Link',
                isActive: editorState.isLink,
                action: () => setLinkDialogOpen(true),
                element: (
                    <Button
                        key="link"
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setLinkDialogOpen(true)}
                        className={`h-8 px-2 ${editorState.isLink ? 'bg-accent' : ''}`}
                        disabled={disabled}
                    >
                        <LinkIcon className="h-4 w-4" />
                    </Button>
                ),
            },
            {
                id: 'image',
                priority: 7,
                label: 'Image',
                isActive: editorState.isImage,
                action: () => setImageDialogOpen(true),
                element: (
                    <Button
                        key="image"
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setImageDialogOpen(true)}
                        className={`h-8 px-2 ${editorState.isImage ? 'bg-accent' : ''}`}
                        disabled={disabled}
                    >
                        <ImageIcon className="h-4 w-4" />
                    </Button>
                ),
            },
            {
                id: 'blockquote',
                priority: 8,
                label: 'Blockquote',
                isActive: editorState.isBlockquote,
                action: () => editor.chain().focus().toggleBlockquote().run(),
                element: (
                    <Button
                        key="blockquote"
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => editor.chain().focus().toggleBlockquote().run()}
                        className={`h-8 px-2 ${editorState.isBlockquote ? 'bg-accent' : ''}`}
                        disabled={disabled}
                    >
                        <QuoteIcon className="h-4 w-4" />
                    </Button>
                ),
            },
            {
                id: 'table',
                priority: 9,
                label: 'Table',
                isActive: editorState.isTable,
                action: () =>
                    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
                element: (
                    <Button
                        key="table"
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                            editor
                                .chain()
                                .focus()
                                .insertTable({
                                    rows: 3,
                                    cols: 3,
                                    withHeaderRow: true,
                                })
                                .run()
                        }
                        className={`h-8 px-2 ${editorState.isTable ? 'bg-accent' : ''}`}
                        disabled={disabled || !canInsertTable}
                    >
                        <TableIcon className="h-4 w-4" />
                    </Button>
                ),
            },
            {
                id: 'undo',
                priority: 10,
                label: 'Undo',
                action: () => editor.chain().focus().undo().run(),
                element: (
                    <Button
                        key="undo"
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => editor.chain().focus().undo().run()}
                        disabled={disabled || !canUndo}
                        className="h-8 px-2"
                    >
                        <Undo2Icon className="h-4 w-4" />
                    </Button>
                ),
            },
            {
                id: 'redo',
                priority: 11,
                label: 'Redo',
                action: () => editor.chain().focus().redo().run(),
                element: (
                    <Button
                        key="redo"
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => editor.chain().focus().redo().run()}
                        disabled={disabled || !canRedo}
                        className="h-8 px-2"
                    >
                        <Redo2Icon className="h-4 w-4" />
                    </Button>
                ),
            },
        ];
    }, [editor, disabled, linkDialogOpen, imageDialogOpen, canUndo, canRedo, canInsertTable, editorState]);

    useEffect(() => {
        const calculateVisibleItems = () => {
            if (!toolbarRef.current) return;

            const toolbar = toolbarRef.current;
            const toolbarWidth = toolbar.clientWidth;
            const headingSelectWidth = 130; // Fixed width for heading select
            const overflowButtonWidth = 40; // Width for overflow button
            const padding = 16; // Toolbar padding

            let usedWidth = headingSelectWidth + padding;
            const visible: string[] = [];
            const overflow: string[] = [];

            // Always show heading select, so start with remaining width
            let remainingWidth = toolbarWidth - usedWidth;

            // Sort items by priority (lower number = higher priority)
            const sortedItems = [...toolbarItems].sort((a, b) => a.priority - b.priority);

            for (const item of sortedItems) {
                const itemWidth = 40; // Approximate button width

                if (remainingWidth >= itemWidth + (overflow.length === 0 ? 0 : overflowButtonWidth)) {
                    visible.push(item.id);
                    remainingWidth -= itemWidth;
                } else {
                    overflow.push(item.id);
                }
            }

            setVisibleItems(visible);
            setOverflowItems(overflow);
        };

        calculateVisibleItems();

        const resizeObserver = new ResizeObserver(calculateVisibleItems);
        if (toolbarRef.current) {
            resizeObserver.observe(toolbarRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [toolbarItems.length, editor]);

    const visibleElements = toolbarItems
        .filter(item => visibleItems.includes(item.id))
        .sort((a, b) => a.priority - b.priority)
        .map(item => item.element);

    const overflowElements = toolbarItems.filter(item => overflowItems.includes(item.id));

    if (!editor) {
        return null;
    }

    return (
        <div ref={toolbarRef} className="flex items-center gap-1 p-2 border-b bg-muted/30">
            <Select
                items={headingOptions}
                value={getCurrentHeading()}
                onValueChange={value => value != null && handleHeadingChange(value)}
                disabled={disabled}
            >
                <SelectTrigger size="sm" className="w-[130px] py-1">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {headingOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {visibleElements}

            {overflowElements.length > 0 && (
                <DropdownMenu>
                    <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="sm" className="h-8 px-2" disabled={disabled} />}>
                            <MoreHorizontalIcon className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {overflowElements.map((item, index) => (
                            <div key={item.id}>
                                <DropdownMenuItem
                                    onClick={item.action}
                                    disabled={disabled}
                                    className={item.isActive ? 'bg-accent' : ''}
                                >
                                    <Trans>{item.label}</Trans>
                                </DropdownMenuItem>
                                {(index < overflowElements.length - 1 && index === 2) ||
                                index === 4 ||
                                index === 7 ? (
                                    <DropdownMenuSeparator />
                                ) : null}
                            </div>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}

            <LinkDialog editor={editor} isOpen={linkDialogOpen} onClose={() => setLinkDialogOpen(false)} />

            <ImageDialog editor={editor} isOpen={imageDialogOpen} onClose={() => setImageDialogOpen(false)} />
        </div>
    );
}
