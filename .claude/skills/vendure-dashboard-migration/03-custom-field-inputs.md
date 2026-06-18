## Custom Field Inputs

### Old (Angular)

```ts title="src/plugins/common/ui/components/slider-form-input/slider-form-input.component.ts"
import { Component } from '@angular/core';
import { FormControl } from '@angular/forms';
import { IntCustomFieldConfig, SharedModule, FormInputComponent } from '@vendure/admin-ui/core';

@Component({
    template: `
        <input
            type="range"
            [min]="config.min || 0"
            [max]="config.max || 100"
            [formControl]="formControl" />
        {{ formControl.value }}
    `,
    standalone: true,
    imports: [SharedModule],
})
export class SliderControlComponent implements FormInputComponent<IntCustomFieldConfig> {
    readonly: boolean;
    config: IntCustomFieldConfig;
    formControl: FormControl;
}
```

```ts title="src/plugins/common/ui/providers.ts"
import { registerFormInputComponent } from '@vendure/admin-ui/core';
import { SliderControlComponent } from './components/slider-form-input/slider-form-input.component';

export default [
    registerFormInputComponent('slider-form-input', SliderControlComponent),
];
```

### New (React Dashboard)

```tsx title="src/plugins/my-plugin/dashboard/components/color-picker.tsx"
import { Button, Card, CardContent, cn, DashboardFormComponent, Input } from '@vendure/dashboard';
import { useState } from 'react';
import { useFormContext } from 'react-hook-form';

// By typing your component as DashboardFormComponent, the props will be correctly typed
export const ColorPickerComponent: DashboardFormComponent = ({ value, onChange, name }) => {
    const [isOpen, setIsOpen] = useState(false);

    const { getFieldState } = useFormContext();
    const error = getFieldState(name).error;
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57', '#FF9FF3', '#54A0FF', '#5F27CD'];

    return (
        <div className="space-y-2">
            <div className="flex items-center space-x-2">
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className={cn('w-8 h-8 border-2 border-gray-300 p-0', error && 'border-red-500')}
                    style={{ backgroundColor: error ? 'transparent' : value || '#ffffff' }}
                    onClick={() => setIsOpen(!isOpen)}
                />
                <Input value={value || ''} onChange={e => onChange(e.target.value)} placeholder="#ffffff" />
            </div>

            {isOpen && (
                <Card>
                    <CardContent className="grid grid-cols-4 gap-2 p-2">
                        {colors.map(color => (
                            <Button
                                key={color}
                                type="button"
                                variant="outline"
                                size="icon"
                                className="w-8 h-8 border-2 border-gray-300 hover:border-gray-500 p-0"
                                style={{ backgroundColor: color }}
                                onClick={() => {
                                    onChange(color);
                                    setIsOpen(false);
                                }}
                            />
                        ))}
                    </CardContent>
                </Card>
            )}
        </div>
    );
};
```

```tsx title="src/plugins/my-plugin/dashboard/index.tsx"
import { defineDashboardExtension } from '@vendure/dashboard';
import { ColorPickerComponent } from './components/color-picker';

defineDashboardExtension({
    customFormComponents: {
        // Custom field components for custom fields
        customFields: [
            {
                // The "id" is a global identifier for this custom component. We will
                // reference it in the next step.
                id: 'color-picker',
                component: ColorPickerComponent,
            },
        ],
    },
    // ... other extension properties
});
```
