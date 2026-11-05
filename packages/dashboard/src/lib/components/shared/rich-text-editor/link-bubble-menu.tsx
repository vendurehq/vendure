import { Trans, useLingui } from '@lingui/react/macro';
import { Editor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { CheckIcon, ExternalLinkIcon, PencilIcon, UnlinkIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';
import { Label } from '../../ui/label.js';
import { Switch } from '../../ui/switch.js';
import { ToolbarButton } from './toolbar-button.js';

export interface LinkBubbleMenuProps {
    editor: Editor;
    /**
     * Incrementing token which requests the link edit form to open for the
     * current selection (used by the toolbar and selection bubble menu).
     */
    editRequestToken: number;
}

export function LinkBubbleMenu({ editor, editRequestToken }: Readonly<LinkBubbleMenuProps>) {
    const { t } = useLingui();
    const [editing, setEditing] = useState(false);
    const [href, setHref] = useState('');
    const [openInNewTab, setOpenInNewTab] = useState(false);
    const forceOpenRef = useRef(false);
    const requestSelectionRef = useRef<{ from: number; to: number } | null>(null);

    const editorState = useEditorState({
        editor,
        selector: context => ({
            isLink: context.editor.isActive('link'),
            href: context.editor.getAttributes('link').href as string | undefined,
        }),
    });

    useEffect(() => {
        if (editRequestToken === 0) {
            return;
        }
        const { state } = editor;
        const { from, to } = state.selection;
        requestSelectionRef.current = { from, to };

        const attrs = editor.getAttributes('link');
        let initialHref: string = attrs.href ?? '';
        if (!initialHref) {
            const selectedText = state.doc.textBetween(from, to);
            if (/^(https?:\/\/|www\.)/.test(selectedText)) {
                initialHref = selectedText;
            }
        }
        setHref(initialHref);
        setOpenInNewTab(attrs.target === '_blank');
        setEditing(true);
        forceOpenRef.current = true;
        // Dispatch a focus so the bubble menu plugin re-evaluates shouldShow
        editor.chain().focus().run();
    }, [editRequestToken, editor]);

    const shouldShow = useCallback(
        ({ editor: e, from, to }: { editor: Editor; from: number; to: number }) => {
            if (!e.isEditable) {
                return false;
            }
            if (forceOpenRef.current) {
                const requested = requestSelectionRef.current;
                if (requested && requested.from === from && requested.to === to) {
                    return true;
                }
                forceOpenRef.current = false;
            }
            return e.isActive('link');
        },
        [],
    );

    const closeEdit = () => {
        setEditing(false);
        forceOpenRef.current = false;
    };

    const startEditingExistingLink = () => {
        const attrs = editor.getAttributes('link');
        setHref(attrs.href ?? '');
        setOpenInNewTab(attrs.target === '_blank');
        setEditing(true);
    };

    const applyLink = () => {
        const trimmed = href.trim();
        if (!trimmed) {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
        } else {
            const url = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
            editor
                .chain()
                .focus()
                .extendMarkRange('link')
                .setLink({
                    href: url,
                    target: openInNewTab ? '_blank' : '_self',
                    rel: openInNewTab ? 'noopener noreferrer' : undefined,
                })
                .run();
        }
        closeEdit();
    };

    const removeLink = () => {
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
        closeEdit();
    };

    const cancelEdit = () => {
        closeEdit();
        editor.chain().focus().run();
    };

    return (
        <BubbleMenu
            editor={editor}
            pluginKey="linkBubbleMenu"
            shouldShow={shouldShow}
            updateDelay={0}
            options={{
                placement: 'bottom',
                offset: 6,
                onHide: () => {
                    setEditing(false);
                    forceOpenRef.current = false;
                },
            }}
            className="rounded-md border bg-popover text-popover-foreground shadow-md"
            data-testid="link-bubble-menu"
        >
            {editing ? (
                <div className="flex w-80 flex-col gap-2 p-3">
                    <Input
                        value={href}
                        onChange={e => setHref(e.target.value)}
                        placeholder="https://example.com"
                        aria-label={t`Link URL`}
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                applyLink();
                            }
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelEdit();
                            }
                        }}
                    />
                    <div className="flex items-center justify-between gap-2">
                        <Label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                            <Switch checked={openInNewTab} onCheckedChange={setOpenInNewTab} />
                            <Trans>Open in new tab</Trans>
                        </Label>
                        <div className="flex items-center gap-1">
                            <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
                                <Trans>Cancel</Trans>
                            </Button>
                            <Button type="button" size="sm" onClick={applyLink}>
                                <CheckIcon className="h-4 w-4" />
                                <Trans>Apply</Trans>
                            </Button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex max-w-96 items-center gap-1 p-1">
                    <a
                        href={editorState?.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-w-0 items-center gap-1.5 px-2 text-sm text-primary hover:underline"
                    >
                        <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{editorState?.href}</span>
                    </a>
                    <div className="h-5 w-px bg-border" />
                    <ToolbarButton label={t`Edit link`} onClick={startEditingExistingLink}>
                        <PencilIcon className="h-4 w-4" />
                    </ToolbarButton>
                    <ToolbarButton label={t`Remove link`} onClick={removeLink}>
                        <UnlinkIcon className="h-4 w-4" />
                    </ToolbarButton>
                </div>
            )}
        </BubbleMenu>
    );
}
