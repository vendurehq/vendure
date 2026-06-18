import { Component, Input } from '@angular/core';
import { CustomColumnComponent } from '@vendure/admin-ui/core';

@Component({
    selector: 'slug-with-link',
    template: `
        <a [href]="'https://example.com/products/' + rowItem.slug" target="_blank">{{ rowItem.slug }}</a>
    `,
    standalone: true,
})
export class SlugWithLinkComponent implements CustomColumnComponent {
    @Input() rowItem: any;
}
