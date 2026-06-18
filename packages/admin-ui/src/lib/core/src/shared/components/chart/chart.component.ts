import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    SimpleChanges,
    ViewChild,
} from '@angular/core';
import { easings, LineChart, LineChartData, LineChartOptions } from 'chartist';
import { CurrencyService } from '../../../providers/currency/currency.service';
import { tooltipPlugin } from './tooltip-plugin';

export interface ChartFormatOptions {
    formatValueAs: 'currency' | 'number';
    currencyCode?: string;
    locale?: string;
}

export interface ChartEntry {
    label: string;
    value: number;
    formatOptions: ChartFormatOptions;
}

@Component({
    selector: 'vdr-chart',
    templateUrl: './chart.component.html',
    styleUrls: ['./chart.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class ChartComponent implements OnInit, OnChanges, OnDestroy {
    @Input() entries: ChartEntry[] = [];
    @Input() options?: LineChartOptions = {};
    @ViewChild('chartDiv', { static: true }) private chartDivRef: ElementRef<HTMLDivElement>;
    private chart: LineChart;

    constructor(private currencyService: CurrencyService) {}

    ngOnInit() {
        this.chart = new LineChart(
            this.chartDivRef.nativeElement,
            this.entriesToLineChartData(this.entries ?? []),
            {
                low: 0,
                showArea: true,
                showLine: true,
                showPoint: true,
                fullWidth: true,
                axisX: {
                    showLabel: false,
                    showGrid: false,
                    offset: 1,
                },
                axisY: {
                    showLabel: false,
                    offset: 1,
                },
                plugins: [
                    tooltipPlugin({
                        currencyPrecision: this.currencyService.precision,
                        currencyPrecisionFactor: this.currencyService.precisionFactor,
                    }),
                ],
                ...this.options,
            },
        );

        this.chart.on('draw', data => {
            if (data.type === 'line' || data.type === 'area') {
                data.element.animate({
                    d: {
                        begin: 2000 * data.index,
                        dur: 2000,
                        from: data.path.clone().scale(1, 0).translate(0, data.chartRect.height()).stringify(),
                        to: data.path.clone().stringify(),
                        easing: easings.easeOutQuint,
                    },
                });
            }
        });

        // Create the gradient definition on created event (always after chart re-render)
        this.chart.on('created', ctx => {
            const defs = ctx.svg.elem('defs');
            defs
                .elem('linearGradient', {
                    id: 'gradient',
                    x1: 0,
                    y1: 1,
                    x2: 0,
                    y2: 0,
                })
                .elem('stop', {
                    offset: 0,
                    'stop-color': 'var(--color-primary-400)',
                    'stop-opacity': 0.3,
                })
                .parent()
                ?.elem('stop', {
                    offset: 1,
                    'stop-color': 'var(--color-primary-500)',
                });
        });
    }

    ngOnChanges(changes: SimpleChanges) {
        if ('entries' in changes && this.chart) {
            this.chart.update(this.entriesToLineChartData(this.entries ?? []));
        }
    }

    ngOnDestroy() {
        this.chart?.detach();
    }

    private entriesToLineChartData(entries: ChartEntry[]): LineChartData {
        const labels = entries.map(({ label }) => label);
        const series = [
            entries.map(({ label, value, formatOptions }) => ({ meta: { label, formatOptions }, value })),
        ];
        return { labels, series };
    }
}
