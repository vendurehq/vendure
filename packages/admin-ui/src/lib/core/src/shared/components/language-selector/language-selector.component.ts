import { Component, EventEmitter, Input, Output } from '@angular/core';

import { LanguageCode } from '../../../common/generated-types';

@Component({
    selector: 'vdr-language-selector',
    templateUrl: './language-selector.component.html',
    styleUrls: ['./language-selector.component.scss'],
    standalone: false,
})
export class LanguageSelectorComponent {
    @Input() currentLanguageCode: LanguageCode;
    @Input() availableLanguageCodes: LanguageCode[];
    @Input() disabled = false;
    @Output() languageCodeChange = new EventEmitter<LanguageCode>();
}
