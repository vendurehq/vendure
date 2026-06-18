/**
 * Based on https://github.com/tmmdata/chartist-plugin-tooltip/blob/master/src/scripts/chartist-plugin-tooltip.js
 *
 */
/* global Chartist */

import { DrawEvent, LineChart } from 'chartist';
import { ChartFormatOptions } from './chart.component';

const defaultOptions = {
    currency: undefined,
    currencyPrecision: 2,
    currencyPrecisionFactor: 100,
    currencyFormatCallback: undefined,
    tooltipOffset: {
        x: 0,
        y: -20,
    },
    anchorToPoint: false,
    appendToBody: false,
    class: undefined,
    pointClass: 'ct-point',
};

export function tooltipPlugin(userOptions?: Partial<typeof defaultOptions>) {
    return function tooltip(chart: LineChart) {
        const options = {
            ...defaultOptions,
            ...userOptions,
        };

        const $chart = (chart as any).container as HTMLDivElement;
        let $toolTip = $chart.querySelector('.chartist-tooltip') as HTMLDivElement;
        if (!$toolTip) {
            $toolTip = document.createElement('div');
            $toolTip.className = !options.class ? 'chartist-tooltip' : 'chartist-tooltip ' + options.class;
            if (!options.appendToBody) {
                $chart.appendChild($toolTip);
            } else {
                document.body.appendChild($toolTip);
            }
        }
        let height = $toolTip.offsetHeight;
        let width = $toolTip.offsetWidth;
        const points: Array<{
            event: DrawEvent;
            x: number;
        }> = [];

        function getClosestPoint(mouseX: number): DrawEvent {
            let closestElement: DrawEvent | null = null;
            let closestDistance = Infinity;

            // Iterate through the points array to find the closest element
            for (const point of points) {
                const elementX = point.x;
                const distance = calculateDistance(mouseX, elementX);

                if (distance < closestDistance) {
                    closestElement = point.event;
                    closestDistance = distance;
                }
            }
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return closestElement!;
        }

        chart.on('draw', data => {
            if (data.type === 'point') {
                const element = data.element;
                points[data.index] = {
                    event: data,
                    x: data.element.getNode().getBoundingClientRect().x,
                };
            }
        });

        hide($toolTip);

        function on(event, selector, callback) {
            $chart.addEventListener(
                event,
                function (e) {
                    if (!selector || hasClass(e.target, selector)) {
                        callback(e);
                    }
                },
                { passive: true },
            );
        }

        on('mousemove', undefined, (event: MouseEvent) => {
            const closestPoint = getClosestPoint(event.clientX);
            if (!closestPoint) {
                return;
            }
            points.forEach(point => point.event.element.removeClass('ct-tooltip-hover'));
            closestPoint.element.addClass('ct-tooltip-hover');

            const $point = closestPoint.element.getNode() as HTMLElement;
            const meta: {
                label: string;
                formatOptions: ChartFormatOptions;
            } = closestPoint.meta;
            const value = $point.getAttribute('ct:value');

            const dateFormatter = new Intl.DateTimeFormat(meta.formatOptions.locale);
            const formattedValue =
                meta.formatOptions.formatValueAs === 'currency'
                    ? new Intl.NumberFormat(meta.formatOptions.locale, {
                          style: 'currency',
                          currency: meta.formatOptions.currencyCode,
                          minimumFractionDigits: options.currencyPrecision,
                          maximumFractionDigits: options.currencyPrecision,
                      }).format(+(value ?? 0) / options.currencyPrecisionFactor)
                    : new Intl.NumberFormat(meta.formatOptions.locale).format(+(value ?? 0));

            const tooltipText = `
            <div class="tooltip-date">${dateFormatter.format(new Date(meta.label))}</div>
            <div class="tooltip-value">${formattedValue}</div>
           `;

            $toolTip.innerHTML = tooltipText;
            setPosition($point);
            show($toolTip);

            // Remember height and width to avoid wrong position in IE
            height = $toolTip.offsetHeight;
            width = $toolTip.offsetWidth;
        });

        on('mouseleave', undefined, () => {
            hide($toolTip);
        });

        function setPosition(element: HTMLElement) {
            height = height || $toolTip.offsetHeight;
            width = width || $toolTip.offsetWidth;
            const { x: elX, y: elY, width: elWidth, height: elHeight } = element.getBoundingClientRect();
            const offsetX = -width / 2 + options.tooltipOffset.x;
            const offsetY = -height + options.tooltipOffset.y;
            let anchorX;
            let anchorY;

            if (!options.appendToBody) {
                const box = $chart.getBoundingClientRect();
                const left = elX - box.left - window.pageXOffset;
                const top = elY - box.top - window.pageYOffset;

                $toolTip.style.top = (anchorY || top) + offsetY + 'px';
                $toolTip.style.left = (anchorX || left) + offsetX + 'px';
            } else {
                $toolTip.style.top = elY + offsetY + 'px';
                $toolTip.style.left = elX + offsetX + 'px';
            }
        }
    };
}

function show(element) {
    if (!hasClass(element, 'tooltip-show')) {
        element.className = element.className + ' tooltip-show';
    }
}

function hide(element) {
    const regex = new RegExp('tooltip-show' + '\\s*', 'gi');
    element.className = element.className.replace(regex, '').trim();
}

function hasClass(element, className) {
    return (' ' + element.getAttribute('class') + ' ').indexOf(' ' + className + ' ') > -1;
}

function calculateDistance(x1, x2) {
    return Math.abs(x2 - x1);
}
