import { Trans } from '@lingui/react/macro';
import { SetImageOptions } from '@tiptap/extension-image';
import { Editor } from '@tiptap/react';
import { ImageIcon, PaperclipIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog.js';
import { Input } from '../../ui/input.js';
import { Label } from '../../ui/label.js';
import { Asset } from '../asset/asset-gallery.js';
import { AssetPickerDialog } from '../asset/asset-picker-dialog.js';

export interface ImageDialogProps {
    editor: Editor;
    isOpen: boolean;
    onClose: () => void;
}

export function ImageDialog({ editor, isOpen, onClose }: Readonly<ImageDialogProps>) {
    const [src, setSrc] = useState('');
    const [alt, setAlt] = useState('');
    const [title, setTitle] = useState('');
    const [width, setWidth] = useState('');
    const [height, setHeight] = useState('');
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [previewUrl, setPreviewUrl] = useState('');

    useEffect(() => {
        if (isOpen) {
            // Get current image attributes if editing existing image
            const {
                src: currentSrc,
                alt: currentAlt,
                title: currentTitle,
                width: currentWidth,
                height: currentHeight,
            } = editor.getAttributes('image');

            setSrc(currentSrc || '');
            setAlt(currentAlt || '');
            setTitle(currentTitle || '');
            setWidth(currentWidth || '');
            setHeight(currentHeight || '');
            setPreviewUrl(currentSrc || '');
        }
    }, [isOpen, editor]);

    const handleInsertImage = () => {
        if (!src) {
            return;
        }

        const attrs: SetImageOptions = {
            src,
            alt: alt || undefined,
            title: title || undefined,
        };

        // Only add width/height if they are valid numbers
        if (width && !Number.isNaN(Number(width))) {
            attrs.width = Number(width);
        }
        if (height && !Number.isNaN(Number(height))) {
            attrs.height = Number(height);
        }

        editor.chain().focus().setImage(attrs).run();

        handleClose();
    };

    const handleClose = () => {
        setSrc('');
        setAlt('');
        setTitle('');
        setWidth('');
        setHeight('');
        setPreviewUrl('');
        onClose();
    };

    const handleAssetSelect = (assets: Asset[]) => {
        if (assets.length > 0) {
            const asset = assets[0];
            setSrc(asset.source);
            setPreviewUrl(asset.preview);
            // Set width and height from asset if available
            if (asset.width) {
                setWidth(asset.width.toString());
            }
            if (asset.height) {
                setHeight(asset.height.toString());
            }
        }
        setAssetPickerOpen(false);
    };

    const isEditing = editor.isActive('image');

    return (
        <>
            <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
                <DialogContent className="sm:max-w-[525px]">
                    <DialogHeader>
                        <DialogTitle>
                            {isEditing ? <Trans>Edit image</Trans> : <Trans>Insert image</Trans>}
                        </DialogTitle>
                        <DialogDescription className="sr-only">
                            {isEditing ? <Trans>Edit the selected image properties</Trans> : <Trans>Insert a new image with source, title, and dimensions</Trans>}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="flex items-center justify-center">
                            {previewUrl ? (
                                <img
                                    src={previewUrl}
                                    alt={alt || 'Preview'}
                                    className="max-w-[200px] max-h-[200px] object-contain border rounded"
                                />
                            ) : (
                                <div className="w-[200px] h-[200px] border rounded flex items-center justify-center bg-muted">
                                    <ImageIcon className="w-16 h-16 text-muted-foreground" />
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-center">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setAssetPickerOpen(true)}
                            >
                                <PaperclipIcon className="w-4 h-4 mr-2" />
                                <Trans>Add asset</Trans>
                            </Button>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="image-source">
                                <Trans>Source</Trans>
                            </Label>
                            <Input
                                id="image-source"
                                value={src}
                                onChange={e => {
                                    setSrc(e.target.value);
                                    setPreviewUrl(e.target.value);
                                }}
                                placeholder="https://example.com/image.jpg"
                                autoFocus
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="image-title">
                                <Trans>Title</Trans>
                            </Label>
                            <Input
                                id="image-title"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                placeholder=""
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="image-alt">
                                <Trans>Description (alt)</Trans>
                            </Label>
                            <Input
                                id="image-alt"
                                value={alt}
                                onChange={e => setAlt(e.target.value)}
                                placeholder=""
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="image-width">
                                    <Trans>Width</Trans>
                                </Label>
                                <Input
                                    id="image-width"
                                    type="number"
                                    value={width}
                                    onChange={e => setWidth(e.target.value)}
                                    placeholder="auto"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="image-height">
                                    <Trans>Height</Trans>
                                </Label>
                                <Input
                                    id="image-height"
                                    type="number"
                                    value={height}
                                    onChange={e => setHeight(e.target.value)}
                                    placeholder="auto"
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={handleClose}>
                            <Trans>Cancel</Trans>
                        </Button>
                        <Button type="button" onClick={handleInsertImage} disabled={!src}>
                            <Trans>Insert image</Trans>
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AssetPickerDialog
                open={assetPickerOpen}
                onClose={() => setAssetPickerOpen(false)}
                onSelect={handleAssetSelect}
                multiSelect={false}
                title="Select asset"
            />
        </>
    );
}
