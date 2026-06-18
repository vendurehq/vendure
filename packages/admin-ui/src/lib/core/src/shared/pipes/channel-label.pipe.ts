import { Pipe, PipeTransform } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';

@Pipe({
    name: 'channelCodeToLabel',
    standalone: false,
})
export class ChannelLabelPipe implements PipeTransform {
    transform(value: any, ...args: any[]): any {
        if (value === DEFAULT_CHANNEL_CODE) {
            return _('common.default-channel');
        } else {
            return value;
        }
    }
}
