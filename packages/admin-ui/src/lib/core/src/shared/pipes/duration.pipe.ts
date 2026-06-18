import { Pipe, PipeTransform } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';

import { I18nService } from '../../providers/i18n/i18n.service';

/**
 * @description
 * Displays a number of milliseconds in a more human-readable format,
 * e.g. "12ms", "33s", "2:03m"
 *
 * @example
 * ```ts
 * {{ timeInMs | duration }}
 * ```
 *
 * @docsCategory pipes
 */
@Pipe({
    name: 'duration',
    standalone: false,
})
export class DurationPipe implements PipeTransform {
    constructor(private i18nService: I18nService) {}

    transform(value: number): string {
        if (value < 1000) {
            return this.i18nService.translate(_('datetime.duration-milliseconds'), { ms: value });
        } else if (value < 1000 * 60) {
            const seconds1dp = +(value / 1000).toFixed(1);
            return this.i18nService.translate(_('datetime.duration-seconds'), { s: seconds1dp });
        } else {
            const minutes = Math.floor(value / (1000 * 60));
            const seconds = Math.round((value % (1000 * 60)) / 1000)
                .toString()
                .padStart(2, '0');
            return this.i18nService.translate(_('datetime.duration-minutes:seconds'), {
                m: minutes,
                s: seconds,
            });
        }
    }
}
