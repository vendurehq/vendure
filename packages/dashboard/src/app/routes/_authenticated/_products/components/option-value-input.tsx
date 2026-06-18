import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { useLingui } from '@lingui/react/macro';
import { X } from 'lucide-react';
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
                    <Badge key={field.id} variant="secondary" className="flex items-center gap-1 py-1 px-2">
                        {field.value}
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-4 w-4 p-0 ml-1"
                            onClick={() => onRemove(index)}
                        >
                            <X className="h-3 w-3" />
                        </Button>
                    </Badge>
                ))}
            </div>
        </div>
    );
}
