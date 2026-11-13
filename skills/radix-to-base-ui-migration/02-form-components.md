## Form Components Migration

The old Radix/shadcn-based form system (`FormField`, `FormItem`, `FormControl`, etc.) has been replaced with `FormFieldWrapper` and Base UI Field primitives.

### Recommended Path: Use FormFieldWrapper

`FormFieldWrapper` is the recommended way to create form fields in dashboard extensions. It handles labels, descriptions, error display, and accessibility automatically.

#### Before
```tsx
import {
    Form,
    FormField,
    FormItem,
    FormControl,
    FormLabel,
    FormDescription,
    FormMessage,
    Input,
} from '@vendure/dashboard';

<Form {...form}>
    <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
            <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                    <Input {...field} />
                </FormControl>
                <FormDescription>Enter a description</FormDescription>
                <FormMessage />
            </FormItem>
        )}
    />
</Form>
```

#### After
```tsx
import { FormFieldWrapper, Input } from '@vendure/dashboard';

<FormFieldWrapper
    control={form.control}
    name="description"
    label="Description"
    description="Enter a description"
    render={({ field }) => <Input {...field} />}
/>
```

### Advanced Path: Controller + Field Primitives

For complex form fields that don't fit the `FormFieldWrapper` pattern, use `Controller` with Field primitives — both from `@vendure/dashboard`.

#### Before
```tsx
import {
    FormField,
    FormItem,
    FormControl,
    FormLabel,
    FormMessage,
} from '@vendure/dashboard';

<FormField
    control={form.control}
    name="color"
    render={({ field }) => (
        <FormItem>
            <FormLabel>Color</FormLabel>
            <FormControl>
                <div className="flex gap-2">
                    <input type="color" value={field.value} onChange={field.onChange} />
                    <span>{field.value}</span>
                </div>
            </FormControl>
            <FormMessage />
        </FormItem>
    )}
/>
```

#### After
```tsx
import { Field, FieldLabel, FieldError } from '@vendure/dashboard';
import { Controller } from '@vendure/dashboard';

<Controller
    control={form.control}
    name="color"
    render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
            <FieldLabel>Color</FieldLabel>
            <div className="flex gap-2">
                <input type="color" value={field.value} onChange={field.onChange} />
                <span>{field.value}</span>
            </div>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
    )}
/>
```

### Component Mapping

| Old (Radix/shadcn) | New (Base UI) | Notes |
|---|---|---|
| `FormField` | `FormFieldWrapper` or `Controller` | `FormFieldWrapper` recommended for standard fields |
| `FormItem` | `Field` | Container component |
| `FormControl` | *(removed)* | Content goes directly inside `Field` |
| `FormLabel` | `FieldLabel` or `label` prop on `FormFieldWrapper` | |
| `FormMessage` | `FieldError` | Takes `errors` array prop: `errors={[fieldState.error]}` |
| `FormDescription` | `FieldDescription` or `description` prop on `FormFieldWrapper` | |
| `Form` | `Form` | Still available, wraps `FormProvider` from react-hook-form |

### Import Changes
```tsx
// REMOVE these imports from @vendure/dashboard:
// FormField, FormItem, FormControl, FormLabel, FormMessage, FormDescription

// ADD instead:
import { FormFieldWrapper } from '@vendure/dashboard';
// Or for advanced usage:
import { Field, FieldLabel, FieldDescription, FieldError } from '@vendure/dashboard';
import { Controller } from '@vendure/dashboard';
```

### FormFieldWrapper Props
- `control` — from `form.control`
- `name` — field name
- `label` — label text (ReactNode)
- `description` — help text (ReactNode)
- `render` — render callback receiving `{ field }` (same as Controller)
- `renderFormControl` — (default: `true`) whether to inject `id` and `aria-invalid` props. Set to `false` for components like `Select` that manage their own trigger element
