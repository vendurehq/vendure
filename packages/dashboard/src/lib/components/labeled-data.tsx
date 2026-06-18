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
 */
export function LabeledData({ label, value, className }: Readonly<LabeledDataProps>) {
    return (
        <div className="">
            <span className="font-medium text-muted-foreground text-xs">{label}</span>
            <div className={`col-span-2 text-sm ${className}`}>{value}</div>
        </div>
    );
}
