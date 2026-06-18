import { cn } from '@/vdb/lib/utils.js';
import { useCopyToClipboard } from '@uidotdev/usehooks';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';

export interface CopyableTextProps {
    /**
     * @description
     * The value to copy to the clipboard.
     */
    value: string;
    /**
     * @description
     * The content to render. Styling is entirely up to the consumer.
     * If omitted, the `value` is rendered as plain text.
     */
    children?: React.ReactNode;
    /**
     * @description
     * Optional className applied to the outer container.
     */
    className?: string;
}

/**
 * @description
 * Renders children alongside a copy-to-clipboard button. Shows a green checkmark
 * for 2 seconds after a successful copy. Does not apply any styling to the children —
 * all presentation is controlled by the consumer.
 *
 * @example
 * ```tsx
 * <CopyableText value={entity.id}>
 *     <span className="font-mono text-sm">{entity.id}</span>
 * </CopyableText>
 *
 * <CopyableText value={order.code}>
 *     <Badge>{order.code}</Badge>
 * </CopyableText>
 *
 * // Plain text fallback — renders value as-is
 * <CopyableText value={entity.id} />
 * ```
 *
 * @docsCategory components
 * @docsPage CopyableText
 * @docsWeight 0
 * @since 3.4.0
 */
export function CopyableText({ value, children, className }: Readonly<CopyableTextProps>) {
    const [copied, setCopied] = useState(false);
    const [, copy] = useCopyToClipboard();

    const handleCopy = async () => {
        await copy(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className={cn('flex items-center gap-1.5', className)}>
            {children ?? value}
            <button
                type="button"
                onClick={handleCopy}
                className="p-0.5 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground"
            >
                {copied ? (
                    <CheckIcon className="h-3.5 w-3.5 text-success" />
                ) : (
                    <CopyIcon className="h-3.5 w-3.5" />
                )}
            </button>
        </div>
    );
}
