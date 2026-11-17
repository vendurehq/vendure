import { useLingui } from '@lingui/react/macro';
import { CopyableText as BaseCopyableText } from '@vendure-io/ui/components/molecules/copyable-text';

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
    /**
     * @description
     * Accessible label for the copy button. Defaults to the localized "Copy" label.
     */
    copyLabel?: string;
    /**
     * @description
     * Accessible label after copying. Defaults to the localized "Copied" label.
     */
    copiedLabel?: string;
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
export function CopyableText({
    value,
    children,
    className,
    copyLabel,
    copiedLabel,
}: Readonly<CopyableTextProps>) {
    const { t } = useLingui();

    return (
        <BaseCopyableText
            value={value}
            className={className}
            copyLabel={copyLabel ?? t`Copy`}
            copiedLabel={copiedLabel ?? t`Copied`}
        >
            {children}
        </BaseCopyableText>
    );
}
