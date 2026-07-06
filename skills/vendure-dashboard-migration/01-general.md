## General

- For short we use "old" to refer to code written for the Angular Admin UI, and "new" for the React Dashboard
- old code is usually in a plugin's "ui" dir
- new code should be in a plugin's "dashboard" dir
- new code imports all components from `@vendure/dashboard`. It can also import the following as needed:
    - hooks or anything else needed from `react`
    - hooks etc from `@tanstack/react-query`
    - `Link`, `useNavigate` etc from `@tanstack/react-router`
    - `useForm` etc from `react-hook-form`
    - `toast` from `sonner`
    - icons from `lucide-react`
    - for i18n: `Trans`, `useLingui` from `@lingui/react/macro`
- Default to the style conventions of the current project as much as possible (single vs double quotes,
  indent size etc)


## Directory Structure
Given as an example - projects may differ in conventions

### Old

```
- /path/to/plugin
    - /ui
        - providers.ts
        - routes.ts
            - /components
                - /example
                    - example.component.ts
                    - example.component.html
                    - example.component.scss
                    - example.graphql.ts
```


### New

```
- /path/to/plugin
    - /dashboard
        - index.tsx
            - /components
                - example.tsx
```

## Registering extensions

### Old

```ts title="src/plugins/my-plugin/my.plugin.ts"
import * as path from 'path';
import { VendurePlugin } from '@vendure/core';
import { AdminUiExtension } from '@vendure/ui-devkit/compiler';

@VendurePlugin({
    // ...
})
export class MyPlugin {
    static ui: AdminUiExtension = {
        id: 'my-plugin-ui',
        extensionPath: path.join(__dirname, 'ui'),
        routes: [{ route: 'my-plugin', filePath: 'routes.ts' }],
        providers: ['providers.ts'],
    };
}
```

### New

```ts title="src/plugins/my-plugin/my.plugin.ts"
import { VendurePlugin } from '@vendure/core';

@VendurePlugin({
    // ...
    // Note that this needs to match the relative path to the
    // index.tsx file from the plugin file
    dashboard: '../dashboard/index.tsx',
})
export class MyPlugin {
    // Do not remove any existing AdminUiExtension def
    // to preserve backward compatibility
    static ui: AdminUiExtension = { /* ... */ }
}
```

Important:
  - Ensure the `dashboard` path is correct relative to the locations of the plugin.ts file and the index.ts file

## Styling

### Old

custom design system based on Clarity UI

```html
<button class="button primary">Primary</button>
<button class="button secondary">Secondary</button>
<button class="button success">Success</button>
<button class="button warning">Warning</button>
<button class="button danger">Danger</button>

<button class="button-ghost">Ghost</button>

<a class="button-ghost" [routerLink]="['/extensions/my-plugin/my-custom-route']">
    <clr-icon shape="arrow" dir="right"></clr-icon>
    John Smith
</a>

<button class="button-small">Small</button>

<button class="button-small">
    <clr-icon shape="layers"></clr-icon>
    Assign to channel
</button>

<clr-icon shape="star" size="8"></clr-icon>

<img [src]="product.featuredAsset?.preview + '?preset=small'" alt="Product preview" />
```

### New

Tailwind + Vendure Design System (Base UI). All UI components import from `@vendure/dashboard`

```tsx
import { Button, DetailPageButton, VendureImage } from '@vendure/dashboard';
import { Star } from 'lucide-react';

export function MyComponent() {
    return (
        <Button variant="default">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="destructive">Danger</Button>
        <Button variant="ghost">Ghost</Button>
        
        <DetailPageButton id="123" label="John Smith" />
        <DetailPageButton href="/affiliates/my-custom-route" label="John Smith" />
        
        <Star />
        
        <VendureImage
            src={entity.product.featuredAsset}
            alt={entity.product.name}
            preset='small'
        />
    )
} 
```

Important:

  - When using `Badge`, prefer variant="secondary" unless especially important data
  - Where possible avoid specific tailwind colours like `text-blue-600`. Instead use (where possible)
    the semantic design token colours, eg:
    ```
    --color-background
    --color-foreground
    --color-primary
    --color-primary-foreground
    --color-secondary
    --color-secondary-foreground
    --color-muted
    --color-muted-foreground
    --color-accent
    --color-accent-foreground
    --color-destructive
    --color-destructive-foreground
    --color-success
    --color-success-foreground
    ```
  - Buttons which link to detail pages should use `DetailPageButton`

## Data access

### Old

```ts
import { DataService } from '@vendure/admin-ui/core';
import { graphql } from "../gql";  
  
export const GET_CUSTOMER_NAME = graphql(`  
    query GetCustomerName($id: ID!) {  
        customer(id: $id) {  
            id  
            firstName            
            lastName
            addresses {
              ...AddressFragment
            }
        }    
	}
`);

this.dataService.query(GET_CUSTOMER_NAME, {  
    id: customerId,  
}),
```

### New

```ts
import { useQuery } from '@tanstack/react-query';  
import { api } from '@vendure/dashboard';  
import { graphql } from '@/gql';

const addressFragment = graphql(`
   # ...
`);

const getCustomerNameDocument = graphql(`  
    query GetCustomerName($id: ID!) {  
        customer(id: $id) {  
            id  
            firstName            
            lastName              
            addresses {
              ...AddressFragment
            }
        }    
	}
`, [addressFragment]);  // Fragments MUST be explicitly referenced

const { data, isLoading, error } = useQuery({  
	queryKey: ['customer-name', customerId],  
	queryFn: () => api.query(getCustomerNameDocument, { id: customerId }),
});
```

Note on graphql fragments: if common fragments are used across files, you may need
to extract them into a common-fragments.graphql.ts file, because with gql.tada they
*must* be explicitly referenced in every document that uses them.
