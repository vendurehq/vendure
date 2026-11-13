## Import Consolidation Rules

### The Golden Rule
All UI component imports MUST come from `@vendure/dashboard`. Never import directly from:
- `@radix-ui/react-*`
- `@vendure-io/ui/*`
- `@base-ui/react/*`

### Migration Patterns

#### Direct Radix imports → @vendure/dashboard
```tsx
// BEFORE
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Checkbox } from '@radix-ui/react-checkbox';

// AFTER
import { Dialog, DialogContent, DialogTrigger, Checkbox } from '@vendure/dashboard';
```

#### @vendure-io/ui imports → @vendure/dashboard
```tsx
// BEFORE
import { Button } from '@vendure-io/ui/components/ui/button';
import { Field, FieldLabel } from '@vendure-io/ui/components/ui/field';

// AFTER
import { Button, Field, FieldLabel } from '@vendure/dashboard';
```

#### @base-ui/react imports → @vendure/dashboard
```tsx
// BEFORE
import { Dialog } from '@base-ui/react/dialog';

// AFTER
import { Dialog } from '@vendure/dashboard';
```

#### Namespace imports → Named imports
```tsx
// BEFORE
import * as AccordionPrimitive from '@radix-ui/react-accordion';
// Usage: <AccordionPrimitive.Root>

// AFTER
import { Accordion } from '@vendure/dashboard';
// Usage: <Accordion>
```

### Approved Third-Party Imports

Most third-party utilities are re-exported from `@vendure/dashboard` (react-hook-form, tanstack query/router, sonner). Prefer importing from `@vendure/dashboard` when available.

The following are the cases where you MUST import directly from the third-party package:

| Package | What to import | Why direct import is required |
|---|---|---|
| `react` | hooks (`useState`, `useEffect`, etc.) | React is a peer dependency |
| `@lingui/react/macro` | `Trans`, `useLingui` | **Babel macros cannot be re-exported** — they must be processed at compile time in the extension's build. This is the `/macro` path specifically; non-macro `useLingui` from `@lingui/react` IS re-exported from `@vendure/dashboard` |
| `lucide-react` | Icon components (`PlusIcon`, `TrashIcon`, etc.) | Only the `LucideIcon` type is re-exported; actual icon components must be imported directly |

The following are re-exported from `@vendure/dashboard` and should be imported from there:

| Available from `@vendure/dashboard` | Original package |
|---|---|
| `useForm`, `useFormContext`, `Controller`, `useFieldArray`, `useWatch`, `FormProvider` | `react-hook-form` |
| `useQuery`, `useMutation`, `useQueryClient`, `useInfiniteQuery` | `@tanstack/react-query` |
| `Link`, `useNavigate`, `useRouter`, `useBlocker`, `useRouterState`, `Outlet` | `@tanstack/react-router` |
| `toast` | `sonner` |
| `useLingui` (non-macro), `I18n`, `MessageDescriptor`, `Messages` | `@lingui/react`, `@lingui/core` |

### Common Radix → Dashboard Name Mappings

Most component names stay the same. The key differences:
- `*Primitive.Root` → just the component name (e.g., `AccordionPrimitive.Root` → `Accordion`)
- `*Primitive.Trigger` → `*Trigger` (e.g., `DialogPrimitive.Trigger` → `DialogTrigger`)
- Form components have different names (see 02-form-components.md)
