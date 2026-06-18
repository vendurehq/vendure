## Custom Detail Components

### Old (Angular)
```ts title="src/plugins/cms/ui/components/product-info/product-info.component.ts"
import { Component, OnInit } from '@angular/core';
import { Observable, switchMap } from 'rxjs';
import { FormGroup } from '@angular/forms';
import { DataService, CustomDetailComponent, SharedModule } from '@vendure/admin-ui/core';
import { CmsDataService } from '../../providers/cms-data.service';

@Component({
    template: `
        <vdr-card title="CMS Info">
            <pre>{{ extraInfo$ | async | json }}</pre>
        </vdr-card>`,
    standalone: true,
    providers: [CmsDataService],
    imports: [SharedModule],
})
export class ProductInfoComponent implements CustomDetailComponent, OnInit {
    // These two properties are provided by Vendure and will vary
    // depending on the particular detail page you are embedding this
    // component into. In this case, it will be a "product" entity.
    entity$: Observable<any>
    detailForm: FormGroup;

    extraInfo$: Observable<any>;

    constructor(private cmsDataService: CmsDataService) {
    }

    ngOnInit() {
        this.extraInfo$ = this.entity$.pipe(
            switchMap(entity => this.cmsDataService.getDataFor(entity.id))
        );
    }
}
```

### New (React Dashboard)

```tsx title="src/plugins/my-plugin/dashboard/index.tsx"
import { defineDashboardExtension } from '@vendure/dashboard';

defineDashboardExtension({
    pageBlocks: [
        {
            id: 'related-articles',
            title: 'Related Articles',
            location: {
                // This is the pageId of the page where this block will be
                pageId: 'product-detail',
                // can be "main" or "side"
                column: 'side',
                position: {
                    // Blocks are positioned relative to existing blocks on
                    // the page.
                    blockId: 'facet-values',
                    // Can be "before", "after" or "replace"
                    // Here we'll place it after the `facet-values` block.
                    order: 'after',
                },
            },
            component: ({ context }) => {
                // In the component, you can use the `context` prop to
                // access the entity and the form instance.
                return <div className="text-sm">Articles related to {context.entity.name}</div>;
            },
        },
    ],
});
```
