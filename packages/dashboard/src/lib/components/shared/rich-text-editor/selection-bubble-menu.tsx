import { useLingui } from '@lingui/react/macro';
import { NodeSelection } from '@tiptap/pm/state';
import { Editor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { BoldIcon, CodeIcon, ItalicIcon, LinkIcon, StrikethroughIcon, UnderlineIcon } from 'lucide-react';
import { useCallback } from 'react';

import { ToolbarButton } from './toolbar-button.js';

export interface SelectionBubbleMenuProps {
    editor: Editor;
    onRequestLinkEdit: () => void;
}

export function SelectionBubbleMenu({ editor, onRequestLinkEdit }: Readonly<SelectionBubbleMenuProps>) {
    const { t } = useLingui();

    const editorState = useEditorState({
        editor,
        selector: context => ({
            isBold: context.editor.isActive('bold'),
            isItalic: context.editor.isActive('italic'),
            isUnderline: context.editor.isActive('underline'),
            isStrike: context.editor.isActive('strike'),
            isCode: context.editor.isActive('code'),
            isLink: context.editor.isActive('link'),
        }),
    });

    const shouldShow = useCallback(({ editor: e }: { editor: Editor }) => {
        const { selection } = e.state;
        if (!e.isEditable || selection.empty) {
            return false;
        }
        if (selection instanceof NodeSelection) {
            return false;
        }
        // The link bubble menu takes over when the selection is inside a link
        if (e.isActive('link') || e.isActive('codeBlock')) {
            return false;
        }
        return true;
    }, []);

    if (!editorState) {
        return null;
    }

    return (
        <BubbleMenu
            editor={editor}
            pluginKey="selectionBubbleMenu"
            shouldShow={shouldShow}
            options={{ placement: 'top', offset: 6 }}
            className="flex items-center gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            data-testid="selection-bubble-menu"
        >
            <ToolbarButton
                label={t`Bold`}
                shortcut="mod+B"
                isActive={editorState.isBold}
                onClick={() => editor.chain().focus().toggleBold().run()}
            >
                <BoldIcon className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                label={t`Italic`}
                shortcut="mod+I"
                isActive={editorState.isItalic}
                onClick={() => editor.chain().focus().toggleItalic().run()}
            >
                <ItalicIcon className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                label={t`Underline`}
                shortcut="mod+U"
                isActive={editorState.isUnderline}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
                <UnderlineIcon className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                label={t`Strikethrough`}
                shortcut="mod+shift+S"
                isActive={editorState.isStrike}
                onClick={() => editor.chain().focus().toggleStrike().run()}
            >
                <StrikethroughIcon className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
                label={t`Inline code`}
                shortcut="mod+E"
                isActive={editorState.isCode}
                onClick={() => editor.chain().focus().toggleCode().run()}
            >
                <CodeIcon className="h-4 w-4" />
            </ToolbarButton>
            <div className="mx-0.5 h-5 w-px bg-border" />
            <ToolbarButton label={t`Link`} isActive={editorState.isLink} onClick={onRequestLinkEdit}>
                <LinkIcon className="h-4 w-4" />
            </ToolbarButton>
        </BubbleMenu>
    );
}
