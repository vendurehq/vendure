import { Component, Input } from '@angular/core';
import { FormControl } from '@angular/forms';
import { NotificationService, PageMetadataService, SharedModule } from '@vendure/admin-ui/core';

@Component({
    selector: 'demo-block',
    template: `
        <div class="mb-4">
            <label>{{ label }}</label>
            <div class="mt-1 flex" style="gap: 12px;">
                <ng-content />
            </div>
        </div>
    `,
    standalone: true,
})
export class DemoBlockComponent {
    @Input() label: string;
}

@Component({
    selector: 'angular-ui',
    templateUrl: './angular-ui.component.html',
    standalone: true,
    imports: [SharedModule, DemoBlockComponent],
})
export class AngularUiComponent {
    pageTitleControl = new FormControl('Angular UI');
    invalidFormControl = new FormControl('', () => ({ invalid: true }));
    constructor(
        private notificationService: NotificationService,
        private pageMetadataService: PageMetadataService,
    ) {}

    canDeactivate() {
        return this.pageTitleControl.pristine;
    }

    updateTitle() {
        const title = this.pageTitleControl.value;
        if (title) {
            this.pageMetadataService.setTitle(title);
            this.notificationService.success(`Updated title to "${title}"`);
            this.pageTitleControl.markAsPristine();
        }
    }
}
