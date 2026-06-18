import { Component, inject } from '@angular/core';
import { PageMetadataService, registerRouteComponent, SharedModule } from '@vendure/admin-ui/core';

@Component({
    selector: 'greeter',
    template: `<vdr-page-block>
        <h1>{{ greeting }}</h1>
        <vdr-card>
            <input [(ngModel)]="title" />
            <button class="button secondary" (click)="setTitle()">Set title</button>
        </vdr-card>
    </vdr-page-block>`,
    standalone: true,
    imports: [SharedModule],
})
export class GreeterComponent {
    greeting = 'Hello!';
    title = 'Greeter Page';
    private pageMetadataService = inject(PageMetadataService);

    setTitle() {
        this.pageMetadataService.setTitle(this.title);
        this.pageMetadataService.setBreadcrumbs(this.title);
    }
}

export default [
    registerRouteComponent({
        component: GreeterComponent,
        path: 'greet',
        title: 'Greeter Page',
    }),
];
