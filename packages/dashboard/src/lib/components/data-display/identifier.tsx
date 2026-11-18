import { IdChip } from '@/vdb/components/ui/id-chip.js';
import { useLingui } from '@lingui/react/macro';

/**
 * @description
 * Displays an identifier such as a code, slug or SKU in a data table cell. At rest it reads as
 * plain text in line with the column header. While the row is hovered or holds keyboard focus
 * it becomes a copy chip. A click on the chip copies the full value and does not open the row.
 * An empty value leaves the cell blank.
 *
 * @docsCategory components
 * @docsPage IdentifierDisplay
 * @since 4.0.0
 */
export function IdentifierDisplay({ value }: Readonly<{ value: string | null | undefined }>) {
    const { t } = useLingui();
    if (!value) {
        return null;
    }
    return <IdChip value={value} truncate="none" reveal="row" copyLabel={t`Copy`} copiedLabel={t`Copied`} />;
}
