import { Tooltip, TooltipContent, TooltipTrigger } from '@/vdb/components/ui/tooltip.js';
import { useLingui } from '@lingui/react/macro';

export type StockLevel = {
    stockOnHand: number;
    stockAllocated: number;
};

export function StockLevelLabel({ stockLevels }: Readonly<{ stockLevels: StockLevel[] }>) {
    const { t } = useLingui();

    if (!Array.isArray(stockLevels)) {
        return null;
    }
    const totalOnHand = stockLevels.reduce((acc, curr) => acc + curr.stockOnHand, 0);
    const totalAllocated = stockLevels.reduce((acc, curr) => acc + curr.stockAllocated, 0);

    return (
        <Tooltip>
            <TooltipTrigger render={<span className="tabular-nums" />}>
                {totalOnHand} <span className="text-muted-foreground">/ {totalAllocated}</span>
            </TooltipTrigger>
            <TooltipContent>
                {`${t`Stock on hand`}: ${totalOnHand}, ${t`Stock allocated`}: ${totalAllocated}`}
            </TooltipContent>
        </Tooltip>
    );
}
