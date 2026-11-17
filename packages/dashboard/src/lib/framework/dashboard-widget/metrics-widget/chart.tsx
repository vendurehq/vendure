import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/vdb/components/ui/chart.js';
import { useWidgetDimensions } from '@/vdb/hooks/use-widget-dimensions.js';
import { type CSSProperties, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

export function MetricsChart({
    chartData,
    formatValue,
    dataLabel,
}: {
    chartData: any[];
    formatValue: (value: any) => string;
    dataLabel: string;
}) {
    const { width, height } = useWidgetDimensions();

    const yAxisWidth = useMemo(() => {
        const maxValue = Math.max(0, ...chartData.map(d => d.sales));
        const formatted = String(formatValue(maxValue));
        return Math.max(60, formatted.length * 7);
    }, [chartData, formatValue]);

    const chartConfig = useMemo(
        () => ({ sales: { label: dataLabel, color: 'var(--color-brand)' } }) satisfies ChartConfig,
        [dataLabel],
    );

    return (
        <ChartContainer config={chartConfig} className="aspect-auto" style={{ width, height }}>
            <AreaChart data={chartData}>
                <defs>
                    <linearGradient id="gradientFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-sales)" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="var(--color-sales)" stopOpacity={0.05} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="var(--color-border)" />
                <XAxis className="text-xs" dataKey="name" interval={2} />
                <YAxis className="text-xs" width={yAxisWidth} tickFormatter={formatValue} />
                <ChartTooltip
                    content={
                        <ChartTooltipContent
                            formatter={(value, name, item) => (
                                <>
                                    <div
                                        className="size-2.5 shrink-0 rounded-[2px] bg-(--color-bg)"
                                        style={{ '--color-bg': item.color } as CSSProperties}
                                    />
                                    <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                                        <span className="text-muted-foreground">{name}</span>
                                        <span className="text-foreground font-mono font-medium tabular-nums">
                                            {formatValue(value)}
                                        </span>
                                    </div>
                                </>
                            )}
                        />
                    }
                />
                <Area
                    type="monotone"
                    dataKey="sales"
                    name={dataLabel}
                    stroke="var(--color-sales)"
                    strokeWidth={2}
                    strokeOpacity={0.8}
                    fill="url(#gradientFill)"
                />
            </AreaChart>
        </ChartContainer>
    );
}
