import { ChangeDetectionStrategy, Component, HostListener, Input, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';

import { DataService } from '../../data/providers/data.service';
import { LocalStorageService } from '../../providers/local-storage/local-storage.service';

@Component({
    selector: 'vdr-theme-switcher',
    templateUrl: './theme-switcher.component.html',
    styleUrls: ['./theme-switcher.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class ThemeSwitcherComponent implements OnInit {
    activeTheme$: Observable<string>;

    constructor(
        private dataService: DataService,
        private localStorageService: LocalStorageService,
    ) {}

    ngOnInit() {
        this.activeTheme$ = this.dataService.client.uiState().mapStream(data => data.uiState.theme);
    }

    @HostListener('click', ['$event'])
    @HostListener('keydown.enter', ['$event'])
    onHostClick() {
        this.activeTheme$.pipe(take(1)).subscribe(current => this.toggleTheme(current));
    }

    toggleTheme(current: string) {
        const newTheme = current === 'default' ? 'dark' : 'default';
        this.dataService.client.setUiTheme(newTheme).subscribe(() => {
            this.localStorageService.set('activeTheme', newTheme);
        });
    }
}
