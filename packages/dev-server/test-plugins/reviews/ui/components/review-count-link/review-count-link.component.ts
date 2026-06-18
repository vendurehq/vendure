import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormControl } from '@angular/forms';
import { CustomFieldConfigType, CustomFieldControl, SharedModule } from '@vendure/admin-ui/core';

@Component({
    selector: 'review-count-link',
    template: ` {{ formControl.value }} `,
    styles: [``],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [SharedModule],
})
export class ReviewCountLinkComponent implements CustomFieldControl {
    readonly: boolean;
    config: CustomFieldConfigType;
    formControl: FormControl;
}
