## Forms

### Old (Angular)
```html
<div class="form-grid">
    <vdr-form-field label="Page title">
        <input type="text" />
    </vdr-form-field>
    <vdr-form-field label="Select input">
        <select>
            <option>Option 1</option>
            <option>Option 2</option>
        </select>
    </vdr-form-field>
    <vdr-form-field label="Checkbox input">
        <input type="checkbox" />
    </vdr-form-field>
    <vdr-form-field label="Textarea input">
        <textarea></textarea>
    </vdr-form-field>
    <vdr-form-field label="With tooltip" tooltip="This is a tooltip for the form input">
        <input type="text" />
    </vdr-form-field>
    <vdr-form-field label="Invalid with error">
        <input type="text" [formControl]="invalidFormControl" />
    </vdr-form-field>
    <vdr-rich-text-editor
        class="form-grid-span"
        label="Description"
    ></vdr-rich-text-editor>
</div>
```

### New (React Dashboard)
```tsx
<PageBlock column="main" blockId="main-form">
    <DetailFormGrid>
        <FormFieldWrapper
            control={form.control}
            name="title"
            label="Title"
            render={({ field }) => <Input {...field} />}
        />
        <FormFieldWrapper
            control={form.control}
            name="slug"
            label="Slug"
            render={({ field }) => <Input {...field} />}
        />
    </DetailFormGrid>
    <div className="space-y-6">
        <FormFieldWrapper
            control={form.control}
            name="body"
            label="Content"
            render={({ field }) => (
                <RichTextInput value={field.value ?? ''} onChange={field.onChange} />
            )}
        />
    </div>
</PageBlock>;
```
