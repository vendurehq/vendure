import { Pipe, PipeTransform } from '@angular/core';

import { CustomFieldConfig, LanguageCode, StringFieldOption } from '../../common/generated-types';

/**
 * Displays a localized description for a CustomField
 */
@Pipe({
    name: 'customFieldDescription',
    pure: true,
    standalone: false,
})
export class CustomFieldDescriptionPipe implements PipeTransform {
    transform(value: CustomFieldConfig, uiLanguageCode: LanguageCode | null): string {
        if (!value) {
            return value;
        }
        const { description } = value;
        if (description) {
            const match = description.find(l => l.languageCode === uiLanguageCode);
            return match ? match.value : description[0].value;
        } else {
            return '';
        }
    }
}
