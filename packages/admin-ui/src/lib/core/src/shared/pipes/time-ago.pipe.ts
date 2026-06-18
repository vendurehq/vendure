import { Pipe, PipeTransform } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import dayjs from 'dayjs';

import { I18nService } from '../../providers/i18n/i18n.service';

/**
 * @description
 * Converts a date into the format "3 minutes ago", "5 hours ago" etc.
 *
 * @example
 * ```HTML
 * {{ order.orderPlacedAt | timeAgo }}
 * ```
 *
 * @docsCategory pipes
 */
@Pipe({
    name: 'timeAgo',
    pure: false,
    standalone: false,
})
export class TimeAgoPipe implements PipeTransform {
    constructor(private i18nService: I18nService) {}

    transform(value: string | Date, nowVal?: string | Date): string {
        const then = dayjs(value);
        const now = dayjs(nowVal || new Date());
        const secondsDiff = now.diff(then, 'second');
        const durations: Array<[number, string]> = [
            [60, _('datetime.ago-seconds')],
            [3600, _('datetime.ago-minutes')],
            [86400, _('datetime.ago-hours')],
            [31536000, _('datetime.ago-days')],
            [Number.MAX_SAFE_INTEGER, _('datetime.ago-years')],
        ];

        let lastUpperBound = 1;
        for (const [upperBound, translationToken] of durations) {
            if (secondsDiff < upperBound) {
                const count = Math.max(0, Math.floor(secondsDiff / lastUpperBound));
                return this.i18nService.translate(translationToken, { count });
            }
            lastUpperBound = upperBound;
        }
        return then.format();
    }
}
