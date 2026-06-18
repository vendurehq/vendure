import { Component, EventEmitter, Input, Output } from '@angular/core';

import { LanguageCode } from '../../common/generated-types';

@Component({
    selector: 'vdr-user-menu',
    templateUrl: './user-menu.component.html',
    styleUrls: ['./user-menu.component.scss'],
    standalone: false,
})
export class UserMenuComponent {
    @Input() userName = '';
    @Input() availableLanguages: LanguageCode[] = [];
    @Input() uiLanguageAndLocale: [LanguageCode, string | undefined];
    @Output() logOut = new EventEmitter<void>();
    @Output() selectUiLanguage = new EventEmitter<void>();
}
