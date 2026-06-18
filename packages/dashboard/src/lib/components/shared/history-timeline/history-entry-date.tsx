import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/vdb/components/ui/tooltip.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';

interface HistoryEntryDateProps {
    date: string;
    className?: string;
}

export function HistoryEntryDate({ date, className }: Readonly<HistoryEntryDateProps>) {
    const { formatRelativeDate, formatDate } = useLocalFormat();

    const formatFullDateTime = (dateString: string) => {
        return formatDate(dateString, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
        });
    };

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger render={<div className={className} />}>
                        {formatRelativeDate(date)}
                </TooltipTrigger>
                <TooltipContent>
                    <p>{formatFullDateTime(date)}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}