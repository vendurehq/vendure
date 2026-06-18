# Creating Storybook Stories for Components

This guide explains how to create high-quality, maintainable Storybook stories for components in this project.

## Table of Contents

1. [Overview](#overview)
2. [Key Principles](#key-principles)
3. [Story File Structure](#story-file-structure)
4. [The withDescription Helper](#the-withdescription-helper)
5. [Interactive argTypes](#interactive-argtypes)
6. [Playground Story](#playground-story)
7. [Demonstration Stories](#demonstration-stories)
8. [Complete Example](#complete-example)
9. [Common Patterns](#common-patterns)

---

## Overview

Our Storybook setup uses a custom build-time plugin system to:
- Extract JSDoc documentation from component source files
- Display descriptions and examples in Storybook without duplication
- Provide interactive controls for component props
- Keep story files clean and maintainable

---

## Key Principles

### ✅ DO:
- Use `withDescription()` helper to extract JSDoc from component files
- Define `argTypes` for key interactive props
- Create a `Playground` story for experimentation
- Keep demonstration stories that show complex interactions or real-world patterns
- Remove trivial stories that only demonstrate props controllable via argTypes

### ❌ DON'T:
- Duplicate documentation between component JSDoc and story files
- Create separate stories for simple prop variations (use argTypes instead)
- Create stories for every possible prop combination
- Leave stories without proper type safety (provide required props like `name`, `onBlur`, `ref`)

---

## Story File Structure

Every story file should follow this structure:

```typescript
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { ComponentName } from './component-name.js';
import { withDescription } from '../../../../.storybook/with-description.js';

const meta = {
    title: 'Category/ComponentName',
    component: ComponentName,
    ...withDescription(import.meta.url, './component-name.js'),
    parameters: {
        layout: 'centered', // or 'fullscreen', 'padded'
    },
    tags: ['autodocs'],
    argTypes: {
        // Define interactive controls here
    },
} satisfies Meta<typeof ComponentName>;

export default meta;
type Story = StoryObj<typeof meta>;

// Playground story (required)
export const Playground: Story = {
    // ...
};

// Demonstration stories (optional, only if needed)
export const ComplexInteraction: Story = {
    // ...
};
```

---

## The withDescription Helper

### What It Does

The `withDescription()` helper extracts JSDoc documentation from your component file and inlines it into Storybook at build time.

### Usage

```typescript
...withDescription(import.meta.url, './component-name.js'),
```

**Parameters:**
- `import.meta.url` - The current module URL (always use exactly this)
- `'./component-name.js'` - Relative path to the component file (use `.js` extension even for `.tsx` files)

### How It Works

1. At build time, the `extractJSDocPlugin` Vite plugin processes story files
2. Finds `withDescription()` calls and reads the component source file
3. Extracts the JSDoc comment from the matching component export
4. Inlines description and `@example` blocks into story metadata
5. Removes the `withDescription` import (no longer needed)

### Component Name Matching

The plugin matches components by converting PascalCase to kebab-case:
- `DateTimeInput` → `datetime-input.js`
- `AffixedInput` → `affixed-input.js`
- `SlugInput` → `slug-input.js`

**Important:** The component filename MUST match the export name when converted to kebab-case.

---

## Interactive argTypes

Define `argTypes` for props that users should be able to control interactively in Storybook.

### When to Define argTypes

Define argTypes for:
- ✅ Common configuration props (prefix, suffix, placeholder, etc.)
- ✅ Boolean toggles (disabled, readonly, etc.)
- ✅ Select options (type, currency, etc.)
- ✅ Numeric ranges (min, max, step, etc.)

Don't define argTypes for:
- ❌ Callback functions (onChange, onBlur, etc.)
- ❌ Complex objects that can't be easily controlled
- ❌ Props rarely changed by end users

### argTypes Examples

```typescript
argTypes: {
    // Text control
    value: {
        control: 'text',
        description: 'The current value',
    },

    // Boolean control
    disabled: {
        control: 'boolean',
        description: 'Whether the input is disabled',
    },

    // Select control
    type: {
        control: 'select',
        options: ['text', 'number', 'email', 'url'],
        description: 'Input type',
    },

    // Number control
    min: {
        control: 'number',
        description: 'Minimum value',
    },
}
```

---

## Playground Story

Every story file should have a `Playground` story as the first story. This allows users to experiment with the component interactively.

### Structure for Form Components

For form components that extend `DashboardFormComponentProps`, use React Hook Form's `register()`:

```typescript
export const Playground: Story = {
    args: {
        // Default values for interactive props
        value: 'Default value',
        disabled: false,
    },
    render: args => {
        const { register } = useForm();
        const field = register('fieldName');
        return <ComponentName {...field} {...args} />;
    },
};
```

### Key Points

1. **args**: Define default values for all interactive props
2. **useForm()**: Use React Hook Form's `useForm` hook
3. **register()**: Register the field to get form props (`name`, `ref`, `onChange`, `onBlur`)
4. **Field spreading**: Use `{...field}` to spread form registration props
5. **Args spreading**: Use `{...args}` to pass argTypes props (will override field defaults)

---

## Demonstration Stories

Create additional stories ONLY when they demonstrate:

### ✅ Keep These Stories:
- **Complex interactions** - Multi-field forms, validation logic, coordinated state
- **Special behaviors** - Edge cases, unusual prop combinations, specific workflows
- **Real-world patterns** - Common usage scenarios that users will implement

### ❌ Remove These Stories:
- **Simple prop variations** - Different values for `disabled`, `placeholder`, etc. (use Playground instead)
- **Single-prop demonstrations** - Stories that only show one prop working
- **Trivial examples** - Anything easily explored through argTypes controls

### Example: Keep This

```typescript
export const ChangePassword: Story = {
    render: () => {
        const [currentPassword, setCurrentPassword] = useState('');
        const [newPassword, setNewPassword] = useState('');
        const [confirmPassword, setConfirmPassword] = useState('');

        return (
            <div className="space-y-4">
                <PasswordInput value={currentPassword} onChange={setCurrentPassword} {...} />
                <PasswordInput value={newPassword} onChange={setNewPassword} {...} />
                <PasswordInput value={confirmPassword} onChange={setConfirmPassword} {...} />

                <div className="text-sm">
                    {newPassword && confirmPassword && newPassword === confirmPassword ? (
                        <span className="text-green-600">Passwords match ✓</span>
                    ) : newPassword && confirmPassword ? (
                        <span className="text-red-600">Passwords do not match ✗</span>
                    ) : (
                        <span>Enter and confirm your new password</span>
                    )}
                </div>
            </div>
        );
    },
};
```

**Why keep:** Shows multi-field validation pattern that's not possible with single component controls.

### Example: Remove This

```typescript
// ❌ Remove - trivially controllable via argTypes
export const Disabled: Story = {
    render: () => {
        return <TextInput value="Test" onChange={() => {}} disabled />;
    },
};

// ❌ Remove - trivially controllable via argTypes
export const WithPlaceholder: Story = {
    render: () => {
        return <TextInput value="" onChange={() => {}} placeholder="Enter text" />;
    },
};
```

**Why remove:** These variations are easily explorable through the Playground story's argTypes controls.

---

## Complete Example

Here's a complete example for a simple input component:

```typescript
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useForm } from 'react-hook-form';
import { TextInput } from './text-input.js';
import { withDescription } from '../../../../.storybook/with-description.js';

const meta = {
    title: 'Form Inputs/TextInput',
    component: TextInput,
    ...withDescription(import.meta.url, './text-input.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        value: {
            control: 'text',
            description: 'The current value',
        },
        disabled: {
            control: 'boolean',
            description: 'Whether the input is disabled',
        },
        placeholder: {
            control: 'text',
            description: 'Placeholder text',
        },
    },
} satisfies Meta<typeof TextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        value: 'Edit me!',
        disabled: false,
        placeholder: 'Enter text',
    },
    render: args => {
        const { register } = useForm();
        const field = register('text');
        return <TextInput {...field} {...args} />;
    },
};

// Only include if it demonstrates something non-trivial
export const LongText: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('longText');
        return <TextInput {...field} />;
    },
};
```

---

## Common Patterns

### Form Components with DashboardFormComponentProps

Form components that extend `DashboardFormComponentProps` use React Hook Form's `register()`:

```typescript
const { register } = useForm();
const field = register('fieldName');
return <ComponentName {...field} {...args} />;
```

The `register()` function automatically provides `name`, `ref`, `onChange`, and `onBlur` props.

### Components with fieldDef

To demonstrate `fieldDef` features (like prefix/suffix or readonly):

```typescript
export const WithPrefixAndSuffix: Story = {
    render: () => {
        const { register } = useForm();
        const field = register('affix');
        return (
            <NumberInput
                {...field}
                fieldDef={{ ui: { prefix: '$', suffix: 'USD' } }}
            />
        );
    },
};
```

### Complex Components (SlugInput, etc.)

For components with complex dependencies (like React Hook Form context), keep all necessary demonstration stories and provide minimal argTypes:

```typescript
const meta = {
    title: 'Form Inputs/SlugInput',
    component: SlugInput,
    ...withDescription(import.meta.url, './slug-input.js'),
    decorators: [
        Story => (
            <div className="w-[500px]">
                <Story />
            </div>
        ),
    ],
    argTypes: {
        // Only define argTypes for truly configurable props
        entityName: {
            control: 'text',
            description: 'The entity name',
        },
        defaultReadonly: {
            control: 'boolean',
            description: 'Whether the input starts in readonly mode',
        },
    },
} satisfies Meta<typeof SlugInput>;

// Keep all demonstration stories that show different behaviors
export const AutoGenerating: Story = { /* ... */ };
export const WithExistingValue: Story = { /* ... */ };
export const ManualEditing: Story = { /* ... */ };
```

---

## Troubleshooting

### withDescription not finding the right component

**Problem:** The plugin extracts JSDoc from the wrong export (e.g., a helper function instead of the component).

**Solution:** Ensure your component filename matches the export name when converted to kebab-case:
- Component: `export function DateTimeInput`
- File: `datetime-input.tsx` ✅
- File: `datetimeinput.tsx` ❌

### Description not appearing in Storybook

**Problem:** The component description doesn't show in Storybook docs.

**Checklist:**
1. Does the component have a JSDoc comment with `@description` tag or description text?
2. Is the `withDescription()` call correct with proper file path?
3. Check the terminal/console for `[extractJSDocPlugin]` logs during build
4. Restart Storybook dev server (changes to plugins require restart)

### Type errors with args

**Problem:** TypeScript errors like "Property 'value' does not exist on type '{}'".

**Solution:** Cast args to the appropriate type:
```typescript
const [value, setValue] = useState(args.value as string);
```

---

## Summary Checklist

When creating a new story file:

- [ ] Import `withDescription` from `../../../.storybook/with-description.js`
- [ ] Add `...withDescription(import.meta.url, './component-name.js')` to meta
- [ ] Define `argTypes` for key interactive props
- [ ] Create a `Playground` story with `args` and interactive state
- [ ] Review existing demonstration stories and remove trivial ones
- [ ] Keep only stories that demonstrate complex interactions or patterns
- [ ] Use `useForm()` and `register()` for form components to automatically provide required props
- [ ] Test that description and examples appear in Storybook docs
- [ ] Verify interactive controls work in the Playground story

---

## Related Files

- **Plugin Implementation:** `.storybook/extract-jsdoc-plugin.js`
- **JSDoc Transformer:** `.storybook/transform-jsdoc-plugin.js`
- **Storybook Config:** `.storybook/main.ts`
- **Example Stories:** `src/lib/components/data-input/*.stories.tsx`
