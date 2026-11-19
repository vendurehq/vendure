import { Button } from '@/vdb/components/ui/button.js';
import { Chip } from '@/vdb/components/ui/chip.js';
import { Input } from '@/vdb/components/ui/input.js';
import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { toast } from 'sonner';

interface OptionValue {
    value: string;
    id: string;
}

interface OptionValueInputProps {
    fields: Array<OptionValue>;
    onAdd: (value: OptionValue) => void;
    onRemove: (index: number) => void;
    disabled?: boolean;
}

export function OptionValueInput({
    fields,
    onAdd,
    onRemove,
    disabled = false,
}: Readonly<OptionValueInputProps>) {
    const [newValue, setNewValue] = useState('');
    const { t } = useLingui();

    const handleAddValue = () => {
        const trimmed = newValue.trim();
        if (!trimmed) return;
        const normalized = trimmed.toLowerCase().normalize();
        if (fields.some(f => f.value.toLowerCase().normalize() === normalized)) {
            toast.error(t`Duplicate value "${trimmed}" already exists`);
            return;
        }
        onAdd({ value: trimmed, id: Date.now().toString() });
        setNewValue('');
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddValue();
        }
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <Input
                    value={newValue}
                    onChange={e => setNewValue(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="Enter value and press Enter"
                    disabled={disabled}
                    className="flex-1"
                />
            </div>

            <div className="flex flex-wrap gap-2">
                {fields.map((field, index) => (
                    <Chip
                        key={field.id}
                        onRemove={() => onRemove(index)}
                        removeLabel={t`Remove ${field.value}`}
                        disabled={disabled}
                    >
                        {field.value}
                    </Chip>
                ))}
            </div>
        </div>
    );
}
