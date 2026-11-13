import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@vendure/dashboard';

export function TooltipButton({
    tooltip,
    tooltipClassName,
    className,
    label,
    children,
}: {
    tooltip: React.ReactNode;
    tooltipClassName?: string;
    className?: string;
    label?: string;
    children: React.ReactNode;
}) {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger
                    render={<Button type="button" variant="ghost" aria-label={label} className={className} />}
                >
                    {children}
                </TooltipTrigger>
                <TooltipContent className={tooltipClassName}>{tooltip}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
