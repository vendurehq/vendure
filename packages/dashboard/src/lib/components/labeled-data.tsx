import {
    DescriptionDetail,
    DescriptionItem,
    DescriptionList,
    DescriptionTerm,
} from '@/vdb/components/ui/description-list.js';

type LabeledDataProps = {
    label: string | React.ReactNode;
    value: React.ReactNode;
    className?: string;
};

/**
 * @description
 * Used to display a value with a label, like
 *
 * Order Code
 * QWERTY
 *
 * Renders a one-item `DescriptionList`. To show several label/value pairs, use
 * `DescriptionList` with `DescriptionListItem` directly, so they share one list.
 */
export function LabeledData({ label, value, className }: Readonly<LabeledDataProps>) {
    return (
        <DescriptionList>
            <DescriptionItem>
                <DescriptionTerm>{label}</DescriptionTerm>
                <DescriptionDetail className={className}>{value}</DescriptionDetail>
            </DescriptionItem>
        </DescriptionList>
    );
}
