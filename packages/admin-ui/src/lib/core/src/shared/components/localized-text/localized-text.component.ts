import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { Observable } from 'rxjs';
import { LanguageCode, LocalizedString } from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';

@Component({
    selector: 'vdr-localized-text',
    templateUrl: './localized-text.component.html',
    styleUrls: ['./localized-text.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class LocalizedTextComponent {
    @Input() text: LocalizedString[] | string;
    uiLanguage$: Observable<LanguageCode>;
    constructor(private dataService: DataService) {
        this.uiLanguage$ = this.dataService.client.uiState().mapStream(data => data.uiState.language);
    }

    isString(value: string | LocalizedString[]): value is string {
        return typeof value === 'string';
    }
}
