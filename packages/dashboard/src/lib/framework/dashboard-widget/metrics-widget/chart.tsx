import { useWidgetDimensions } from '@/vdb/hooks/use-widget-dimensions.js';
import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';

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

    return (
        <AreaChart width={width} height={height} data={chartData}>
            <defs>
                <linearGradient id="gradientFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-brand)" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0.05} />
                </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="var(--color-border)" />
            <XAxis className="text-xs" color="var(--color-foreground)" dataKey="name" interval={2} />
            <YAxis
                className="text-xs"
                color="var(--color-foreground)"
                width={yAxisWidth}
                tickFormatter={formatValue}
            />
            <Tooltip
                formatter={formatValue}
                contentStyle={{
                    borderRadius: 4,
                    padding: 4,
                    paddingLeft: 8,
                    paddingRight: 8,
                    backgroundColor: 'var(--popover)',
                    borderColor: 'var(--border)',
                }}
                labelStyle={{ fontSize: 12, color: 'var(--popover-foreground)' }}
                itemStyle={{ fontSize: 14, color: 'var(--popover-foreground)' }}
            />
            <Area
                type="monotone"
                dataKey="sales"
                name={dataLabel}
                stroke="var(--color-brand)"
                strokeWidth={2}
                strokeOpacity={0.8}
                fill={'url(#gradientFill)'}
            />
        </AreaChart>
    );
}
