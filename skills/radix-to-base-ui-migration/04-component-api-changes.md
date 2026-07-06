## Component API Changes

### Select: `items` Prop Required

The `Select` component now requires an explicit `items` prop for proper label rendering in the trigger.

#### Before
```tsx
<Select value={value} onValueChange={setValue}>
    <SelectTrigger>
        <SelectValue placeholder="Select a country" />
    </SelectTrigger>
    <SelectContent>
        {countries.map(c => (
            <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
        ))}
    </SelectContent>
</Select>
```

#### After
```tsx
<Select
    value={value}
    onValueChange={setValue}
    items={Object.fromEntries(countries.map(c => [c.code, c.name]))}
>
    <SelectTrigger>
        <SelectValue placeholder="Select a country" />
    </SelectTrigger>
    <SelectContent>
        {countries.map(c => (
            <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
        ))}
    </SelectContent>
</Select>
```

Without the `items` prop, the selected option label won't render in the trigger — only the value will show.

### Accordion: Simplified Props

`type="single"` and `collapsible` are now the default behavior and should be removed.

#### Before
```tsx
<Accordion type="single" collapsible className="w-full">
    <AccordionItem value="item-1">
        <AccordionTrigger>Section 1</AccordionTrigger>
        <AccordionContent>Content 1</AccordionContent>
    </AccordionItem>
</Accordion>
```

#### After
```tsx
<Accordion className="w-full">
    <AccordionItem value="item-1">
        <AccordionTrigger>Section 1</AccordionTrigger>
        <AccordionContent>Content 1</AccordionContent>
    </AccordionItem>
</Accordion>
```

### Checkbox & Switch: Null Handling

`null` and `undefined` values for the `checked` prop are now automatically coerced to `false`. No code change needed — this is handled internally by the dashboard's wrapper components. If you were previously adding null guards, they can be removed:

```tsx
// BEFORE (manual null guard)
<Checkbox checked={field.value ?? false} onCheckedChange={field.onChange} />

// AFTER (null guard no longer needed, but harmless to keep)
<Checkbox checked={field.value} onCheckedChange={field.onChange} />
```

### Badge: New Variants

Two new variants are available:
```tsx
<Badge variant="success">Active</Badge>
<Badge variant="warning">Pending</Badge>
```

Existing variants (`default`, `secondary`, `destructive`, `outline`) remain unchanged.

### DropdownMenuItem: onSelect → onClick

If you were using `onSelect` on `DropdownMenuItem`, switch to `onClick`:

#### Before
```tsx
<DropdownMenuItem onSelect={() => handleAction()}>
    Action
</DropdownMenuItem>
```

#### After
```tsx
<DropdownMenuItem onClick={() => handleAction()}>
    Action
</DropdownMenuItem>
```

### data-state Attributes

Radix UI used `data-[state=open]` and `data-[state=closed]` for styling. Base UI uses similar attributes but some may differ. If you have custom CSS using these attributes, verify they still work:

```css
/* These patterns should still work with Base UI */
[data-state="open"] { /* ... */ }
[data-state="closed"] { /* ... */ }
```

If a specific `data-state` attribute no longer works, check the Base UI documentation for the equivalent attribute.
