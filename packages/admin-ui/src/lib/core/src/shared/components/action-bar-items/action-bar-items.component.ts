import { ChangeDetectionStrategy, Component, OnChanges, OnInit } from '@angular/core';
import { assertNever } from '@vendure/common/lib/shared-utils';
import { combineLatest } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { ActionBarItem } from '../../../providers/nav-builder/nav-builder-types';
import { ActionBarBaseComponent } from './action-bar-base.component';

@Component({
    selector: 'vdr-action-bar-items',
    templateUrl: './action-bar-items.component.html',
    styleUrls: ['./action-bar-items.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class ActionBarItemsComponent extends ActionBarBaseComponent<ActionBarItem> implements OnInit {
    ngOnInit() {
        this.items$ = combineLatest([this.navBuilderService.actionBarConfig$, this.locationId$]).pipe(
            map(([items, locationId]) => items.filter(config => config.locationId === locationId)),
            tap(items => {
                this.buildButtonStates(items);
            }),
        );
    }

    getButtonStyles(item: ActionBarItem): string[] {
        const styles = ['button'];
        if (item.buttonStyle && item.buttonStyle === 'link') {
            styles.push('btn-link');
            return styles;
        }
        styles.push(this.getButtonColorClass(item));
        return styles;
    }

    private getButtonColorClass(item: ActionBarItem): string {
        switch (item.buttonColor) {
            case undefined:
                return '';
            case 'primary':
                return item.buttonStyle === 'outline' ? 'btn-outline' : 'primary';
            case 'success':
                return item.buttonStyle === 'outline' ? 'btn-success-outline' : 'success';
            case 'warning':
                return item.buttonStyle === 'outline' ? 'btn-warning-outline' : 'warning';
            default:
                assertNever(item.buttonColor);
                return '';
        }
    }
}
