## Adding Nav Menu Items

### Old (Angular)
```ts
import { addNavMenuSection } from '@vendure/admin-ui/core';

export default [
    addNavMenuSection({
        id: 'greeter',
        label: 'My Extensions',
        items: [{
            id: 'greeter',
            label: 'Greeter',
            routerLink: ['/extensions/greet'],
            // Icon can be any of https://core.clarity.design/foundation/icons/shapes/
            icon: 'cursor-hand-open',
        }],
    },
    // Add this section before the "settings" section
    'settings'),
];
```

### New (React Dashboard)

```tsx
import { defineDashboardExtension } from '@vendure/dashboard';

defineDashboardExtension({
    routes: [
        {
            path: '/my-custom-page',
            component: () => <div>My Custom Page</div>,
            navMenuItem: {
                // The section where this item should appear
                sectionId: 'catalog',
                // Unique identifier for this menu item
                id: 'my-custom-page',
                // Display text in the navigation
                title: 'My Custom Page',
                // Optional: URL if different from path
                url: '/my-custom-page',
            },
        },
    ],
});
```
