import { Pipe, PipeTransform } from '@angular/core';

import { stringToColor } from '../../common/utilities/string-to-color';

@Pipe({
    name: 'stringToColor',
    pure: true,
    standalone: false,
})
export class StringToColorPipe implements PipeTransform {
    transform(value: any): string {
        return stringToColor(value);
    }
}
