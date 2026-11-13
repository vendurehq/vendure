## asChild → render Prop Migration

The `asChild` pattern from Radix UI has been replaced with the `render` prop pattern from Base UI.

### Rule
When a component uses `asChild` to render as a different element, replace it with a `render` prop. The child element becomes the `render` prop value, and the child's children move up to become the parent's direct children.

### Affected Components
Any component that previously accepted `asChild`:
- `Button`
- `DialogTrigger`, `AlertDialogTrigger`
- `PopoverTrigger`
- `SheetTrigger`, `DrawerTrigger`
- `TooltipTrigger`
- `DropdownMenuTrigger`
- `ContextMenuTrigger`
- `CollapsibleTrigger`
- `NavigationMenuLink`
- Any other component that used Radix's `Slot` under the hood

### Pattern: Button with Link

#### Before
```tsx
<Button asChild>
    <Link to="./new">
        <PlusIcon className="mr-2 h-4 w-4" />
        New Item
    </Link>
</Button>
```

#### After
```tsx
<Button render={<Link to="./new" />}>
    <PlusIcon className="mr-2 h-4 w-4" />
    New Item
</Button>
```

### Pattern: Trigger wrapping a Button

#### Before
```tsx
<DialogTrigger asChild>
    <Button variant="outline">Open Dialog</Button>
</DialogTrigger>
```

#### After
```tsx
<DialogTrigger render={<Button variant="outline" />}>
    Open Dialog
</DialogTrigger>
```

### Pattern: Trigger wrapping a non-button element

#### Before
```tsx
<TooltipTrigger asChild>
    <label className="text-sm cursor-default">Permission</label>
</TooltipTrigger>
```

#### After
```tsx
<TooltipTrigger render={<label className="text-sm cursor-default" />}>
    Permission
</TooltipTrigger>
```

### Pattern: PopoverTrigger / SheetTrigger

#### Before
```tsx
<PopoverTrigger asChild>
    <Button variant="outline" size="sm">
        <FilterIcon className="mr-2 h-4 w-4" />
        Filters
    </Button>
</PopoverTrigger>
```

#### After
```tsx
<PopoverTrigger render={<Button variant="outline" size="sm" />}>
    <FilterIcon className="mr-2 h-4 w-4" />
    Filters
</PopoverTrigger>
```

### Transformation Steps
1. Find the element with `asChild` prop (the "parent")
2. Find the single child JSX element inside it (the "child")
3. Take the child's tag name and all its props → move to `render={<ChildTag ...childProps />}`
4. Take the child's children → move up to become the parent's direct children
5. Remove the `asChild` prop from the parent

### Edge Cases
- If the child has no props: `render={<ChildTag />}`
- If the child has no children of its own: the parent will have no children either (self-closing possible)
- Never put children inside the `render` prop JSX — they go as children of the parent element
