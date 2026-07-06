## Widgets

### Old (Angular)
```ts title="src/plugins/reviews/ui/components/reviews-widget/reviews-widget.component.ts"
import { Component, OnInit } from '@angular/core';
import { DataService, SharedModule } from '@vendure/admin-ui/core';
import { Observable } from 'rxjs';

@Component({
    selector: 'reviews-widget',
    template: `
        <ul>
            <li *ngFor="let review of pendingReviews$ | async">
                <a [routerLink]="['/extensions', 'product-reviews', review.id]">{{ review.summary }}</a>
                <span class="rating">{{ review.rating }} / 5</span>
            </li>
        </ul>
    `,
    standalone: true,
    imports: [SharedModule],
})
export class ReviewsWidgetComponent implements OnInit {
    pendingReviews$: Observable<any[]>;

    constructor(private dataService: DataService) {}

    ngOnInit() {
        this.pendingReviews$ = this.dataService.query(gql`
            query GetAllReviews($options: ProductReviewListOptions) {
                productReviews(options: $options) {
                    items {
                        id
                        createdAt
                        authorName
                        summary
                        rating
                    }
                }
            }`, {
                options: {
                    filter: { state: { eq: 'new' } },
                    take: 10,
                },
            })
            .mapStream(data => data.productReviews.items);
    }
}
```

```ts title="src/plugins/reviews/ui/providers.ts"
import { registerDashboardWidget } from '@vendure/admin-ui/core';

export default [
    registerDashboardWidget('reviews', {
        title: 'Latest reviews',
        supportedWidths: [4, 6, 8, 12],
        requiresPermissions: ['ReadReview'],
        loadComponent: () =>
            import('./reviews-widget/reviews-widget.component').then(
                m => m.ReviewsWidgetComponent,
            ),
    }),
];
```

### New (React Dashboard)

```tsx title="custom-widget.tsx"
import { Badge, DashboardBaseWidget, useLocalFormat, useWidgetFilters } from '@vendure/dashboard';

export function CustomWidget() {
    const { dateRange } = useWidgetFilters();
    const { formatDate } = useLocalFormat();
    return (
        <DashboardBaseWidget id="custom-widget" title="Custom Widget" description="This is a custom widget">
            <div className="flex flex-wrap gap-1">
                <span>Displaying results from</span>
                <Badge variant="secondary">{formatDate(dateRange.from)}</Badge>
                <span>to</span>
                <Badge variant="secondary">{formatDate(dateRange.to)}</Badge>
            </div>
        </DashboardBaseWidget>
    );
}
```

```tsx title="index.tsx"
import { defineDashboardExtension } from '@vendure/dashboard';

import { CustomWidget } from './custom-widget';

defineDashboardExtension({
    widgets: [
        {
            id: 'custom-widget',
            name: 'Custom Widget',
            component: CustomWidget,
            defaultSize: { w: 3, h: 3 },
        },
    ],
});
```
