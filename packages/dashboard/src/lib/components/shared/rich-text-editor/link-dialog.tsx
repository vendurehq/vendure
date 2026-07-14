import { Trans } from '@lingui/react/macro';
import { Editor } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { Button } from '../../ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog.js';
import { Input } from '../../ui/input.js';
import { Label } from '../../ui/label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';

export interface LinkDialogProps {
    editor: Editor;
    isOpen: boolean;
    onClose: () => void;
}

export function LinkDialog({ editor, isOpen, onClose }: Readonly<LinkDialogProps>) {
    const [href, setHref] = useState('');
    const [title, setTitle] = useState('');
    const [target, setTarget] = useState<'_self' | '_blank'>('_self');

    useEffect(() => {
        if (isOpen) {
            // Get current link attributes if editing existing link
            const {
                href: currentHref,
                target: currentTarget,
                title: currentTitle,
            } = editor.getAttributes('link');

            setHref(currentHref || '');
            setTitle(currentTitle || '');
            setTarget(currentTarget === '_blank' ? '_blank' : '_self');

            // If text is selected but no link, use selection as initial href if it looks like a URL
            if (!currentHref) {
                const { from, to } = editor.state.selection;
                const selectedText = editor.state.doc.textBetween(from, to);
                if (selectedText && (selectedText.startsWith('http') || selectedText.startsWith('www'))) {
                    setHref(selectedText);
                }
            }
        }
    }, [isOpen, editor]);

    const handleSetLink = () => {
        if (!href) {
            // Remove link if href is empty
            editor.chain().focus().unsetLink().run();
        } else {
            // Set link with all attributes
            editor
                .chain()
                .focus()
                .extendMarkRange('link')
                .setLink({
                    href,
                    target,
                    rel: target === '_blank' ? 'noopener noreferrer' : undefined,
                })
                .run();
        }
        handleClose();
    };

    const handleClose = () => {
        setHref('');
        setTitle('');
        setTarget('_self');
        onClose();
    };

    const handleRemoveLink = () => {
        editor.chain().focus().unsetLink().run();
        handleClose();
    };

    const isEditing = editor.isActive('link');

    return (
        <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>
                        {isEditing ? <Trans>Edit link</Trans> : <Trans>Insert link</Trans>}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        {isEditing ? <Trans>Edit the selected link properties</Trans> : <Trans>Insert a new hyperlink with URL and target options</Trans>}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="link-href" className="text-right">
                            <Trans>Link href</Trans>
                        </Label>
                        <Input
                            id="link-href"
                            value={href}
                            onChange={e => setHref(e.target.value)}
                            placeholder="https://example.com"
                            className="col-span-3"
                            autoFocus
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="link-title" className="text-right">
                            <Trans>Link title</Trans>
                        </Label>
                        <Input
                            id="link-title"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder=""
                            className="col-span-3"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="link-target" className="text-right">
                            <Trans>Link target</Trans>
                        </Label>
                        <Select
                            items={{ '_self': 'Same window', '_blank': 'New window' }}
                            value={target}
                            onValueChange={value => setTarget(value as '_self' | '_blank')}
                        >
                            <SelectTrigger className="col-span-3">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="_self">
                                    <Trans>Same window</Trans>
                                </SelectItem>
                                <SelectItem value="_blank">
                                    <Trans>New window</Trans>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    {isEditing && (
                        <Button type="button" variant="destructive" onClick={handleRemoveLink}>
                            <Trans>Remove link</Trans>
                        </Button>
                    )}
                    <Button type="button" variant="outline" onClick={handleClose}>
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button type="button" onClick={handleSetLink}>
                        <Trans>Set link</Trans>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
