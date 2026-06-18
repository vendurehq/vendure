import { ChangeDetectionStrategy, Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { BehaviorSubject, combineLatest, Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { titleSetter } from '../../../common/title-setter';
import { BreadcrumbService } from '../../../providers/breadcrumb/breadcrumb.service';

@Component({
    selector: 'vdr-page-title',
    templateUrl: './page-title.component.html',
    styleUrls: [`./page-title.component.scss`],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class PageTitleComponent implements OnInit, OnChanges {
    @Input() title = '';
    private titleChange$ = new BehaviorSubject<string | undefined>(undefined);
    protected title$: Observable<string>;
    readonly setTitle = titleSetter();

    constructor(private breadcrumbService: BreadcrumbService) {}

    ngOnInit() {
        this.title$ = combineLatest(this.titleChange$, this.breadcrumbService.breadcrumbs$).pipe(
            map(([title, breadcrumbs]) => {
                if (title) {
                    return title;
                } else {
                    return breadcrumbs[breadcrumbs.length - 1].label;
                }
            }),
            tap(title => this.setTitle(title)),
        );
    }

    ngOnChanges(changes: SimpleChanges) {
        if (changes.title) {
            this.titleChange$.next(changes.title.currentValue);
        }
    }
}
