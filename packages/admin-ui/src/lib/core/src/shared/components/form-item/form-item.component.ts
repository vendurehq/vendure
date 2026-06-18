import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * Like the {@link FormFieldComponent} but for content which is not a form control. Used
 * to keep a consistent layout with other form fields in the form.
 */
@Component({
    selector: 'vdr-form-item',
    templateUrl: './form-item.component.html',
    styleUrls: ['./form-item.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class FormItemComponent {
    @Input() label: string;
    @Input() tooltip: string;
}
