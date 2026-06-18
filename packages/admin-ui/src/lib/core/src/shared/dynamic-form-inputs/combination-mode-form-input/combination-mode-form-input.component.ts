import { ChangeDetectionStrategy, Component, OnInit, Optional } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { DefaultFormComponentConfig, DefaultFormComponentId } from '@vendure/common/lib/shared-types';
import { Observable, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';

import { FormInputComponent, InputComponentConfig } from '../../../common/component-registry-types';
import { ConfigurableInputComponent } from '../../components/configurable-input/configurable-input.component';

/**
 * @description
 * A special input used to display the "Combination mode" AND/OR toggle.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-combination-mode-form-input',
    templateUrl: './combination-mode-form-input.component.html',
    styleUrls: ['./combination-mode-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class CombinationModeFormInputComponent implements FormInputComponent, OnInit {
    static readonly id: DefaultFormComponentId = 'combination-mode-form-input';
    readonly: boolean;
    formControl: UntypedFormControl;
    config: DefaultFormComponentConfig<'combination-mode-form-input'>;
    selectable$: Observable<boolean>;

    constructor(@Optional() private configurableInputComponent: ConfigurableInputComponent) {}

    ngOnInit() {
        const selectable$ = this.configurableInputComponent
            ? this.configurableInputComponent.positionChange$.pipe(map(position => 0 < position))
            : of(true);
        this.selectable$ = selectable$.pipe(
            tap(selectable => {
                if (!selectable) {
                    this.formControl.setValue(true, { emitEvent: false });
                }
            }),
        );
    }

    setCombinationModeAnd() {
        this.formControl.setValue(true);
    }

    setCombinationModeOr() {
        this.formControl.setValue(false);
    }
}
