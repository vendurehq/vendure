import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    Input,
    OnInit,
    Self,
    ViewChild,
} from '@angular/core';

import { combineLatest } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { ActionBarDropdownMenuItem } from '../../../providers/nav-builder/nav-builder-types';
import { ActionBarBaseComponent } from '../action-bar-items/action-bar-base.component';
import { DropdownComponent } from '../dropdown/dropdown.component';

@Component({
    selector: 'vdr-action-bar-dropdown-menu',
    templateUrl: './action-bar-dropdown-menu.component.html',
    styleUrls: ['./action-bar-dropdown-menu.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        // This is a rather involved work-around to allow the {@link DropdownItemDirective} to
        // be able to access the DropdownComponent instance even when it is not a direct parent,
        // as is the case when this component is used.
        {
            provide: DropdownComponent,
            useFactory: (actionBarDropdownMenuComponent: ActionBarDropdownMenuComponent) => {
                return new Promise(resolve =>
                    actionBarDropdownMenuComponent.onDropdownComponentResolved(cmp => resolve(cmp)),
                );
            },
            deps: [[new Self(), ActionBarDropdownMenuComponent]],
        },
    ],
    standalone: false,
})
export class ActionBarDropdownMenuComponent
    extends ActionBarBaseComponent<ActionBarDropdownMenuItem>
    implements OnInit, AfterViewInit
{
    @ViewChild('dropdownComponent')
    dropdownComponent: DropdownComponent;

    @Input()
    alwaysShow = false;

    private onDropdownComponentResolvedFn: (dropdownComponent: DropdownComponent) => void;

    ngOnInit() {
        this.items$ = combineLatest(this.navBuilderService.actionBarDropdownConfig$, this.locationId$).pipe(
            map(([items, locationId]) => items.filter(config => config.locationId === locationId)),
            tap(items => {
                this.buildButtonStates(items);
            }),
        );
    }

    ngAfterViewInit() {
        if (this.onDropdownComponentResolvedFn) {
            this.onDropdownComponentResolvedFn(this.dropdownComponent);
        }
    }

    onDropdownComponentResolved(fn: (dropdownComponent: DropdownComponent) => void) {
        this.onDropdownComponentResolvedFn = fn;
    }
}
