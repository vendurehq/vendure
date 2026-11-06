import { IdChip } from '@/vdb/components/ui/id-chip.js';

/**
 * At rest the chip's border, fill and copy button are transparent, so the value reads as plain
 * text. They fade in while the table row (`group/row`) is hovered or holds keyboard focus.
 * The chip keeps its size in both states, so the text never moves. The negative margin lines
 * the text up with the column header.
 */
const ROW_REVEAL_CHIP_CLASS = [
    '-ml-2 border-transparent bg-transparent',
    'transition-[background-color,border-color,color,scale] duration-fast ease-out motion-reduce:transition-none',
    'group-hover/row:border-border group-hover/row:bg-muted group-focus-within/row:border-border group-focus-within/row:bg-muted',
    '[&_[data-slot=copy-button]]:opacity-0 [&_[data-slot=copy-button]]:transition-opacity [&_[data-slot=copy-button]]:duration-fast motion-reduce:[&_[data-slot=copy-button]]:transition-none',
    'group-hover/row:[&_[data-slot=copy-button]]:opacity-100 group-focus-within/row:[&_[data-slot=copy-button]]:opacity-100',
].join(' ');

/**
 * @description
 * Displays an identifier such as a code, slug or SKU. In a data table row it reads as plain
 * text, and becomes a copy chip while the row is hovered or focused. A click on the chip copies
 * the full value and does not open the row's detail page.
 *
 * @docsCategory components
 * @docsPage IdentifierDisplay
 * @since 3.8.2
 */
export function IdentifierDisplay({ value }: Readonly<{ value: string | null | undefined }>) {
    if (!value) {
        return null;
    }
    return <IdChip value={value} truncate="none" className={ROW_REVEAL_CHIP_CLASS} />;
}
