import {
    AffixedInput,
    Badge,
    Button,
    Card,
    CardContent,
    cn,
    DashboardFormComponent,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
    Textarea,
    useLocalFormat,
} from '@vendure/dashboard';
import { Check, Lock, Mail, RefreshCw, Unlock, X } from 'lucide-react';
import { KeyboardEvent, useEffect, useState } from 'react';
import { useFormContext } from 'react-hook-form';

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

export const MarkdownEditorComponent: DashboardFormComponent = props => {
    const { getFieldState } = useFormContext();
    const fieldState = getFieldState(props.name);

    return (
        <Textarea
            className="font-mono"
            ref={props.ref}
            onBlur={props.onBlur}
            value={props.value}
            onChange={e => props.onChange(e.target.value)}
            disabled={props.disabled}
        />
    );
};

export const EmailInputComponent: DashboardFormComponent = ({ name, value, onChange, disabled }) => {
    const { getFieldState } = useFormContext();
    const isValid = getFieldState(name).invalid === false;

    return (
        <AffixedInput
            prefix={<Mail className="h-4 w-4 text-muted-foreground" />}
            suffix={
                value &&
                (isValid ? (
                    <Check className="h-4 w-4 text-green-500" />
                ) : (
                    <X className="h-4 w-4 text-red-500" />
                ))
            }
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
            placeholder="Enter email address"
            className="pl-10 pr-10"
            name={name}
        />
    );
};

export const MultiCurrencyInputComponent: DashboardFormComponent = ({ value, onChange, disabled, name }) => {
    const [currency, setCurrency] = useState('USD');
    const { formatCurrencyName } = useLocalFormat();

    const currencies = [
        { code: 'USD', symbol: '$', rate: 1 },
        { code: 'EUR', symbol: '€', rate: 0.85 },
        { code: 'GBP', symbol: '£', rate: 0.73 },
        { code: 'JPY', symbol: '¥', rate: 110 },
    ];

    const selectedCurrency = currencies.find(c => c.code === currency) || currencies[0];

    // Convert price based on exchange rate
    const displayValue = value ? (value * selectedCurrency.rate).toFixed(2) : '';

    const handleChange = (val: string) => {
        const numericValue = parseFloat(val) || 0;
        // Convert back to base currency (USD) for storage
        const baseValue = numericValue / selectedCurrency.rate;
        onChange(baseValue);
    };

    return (
        <div className="flex space-x-2">
            <Select value={currency} onValueChange={setCurrency} disabled={disabled}>
                <SelectTrigger className="w-24">
                    <SelectValue>
                        <div className="flex items-center gap-1">{currency}</div>
                    </SelectValue>
                </SelectTrigger>
                <SelectContent>
                    {currencies.map(curr => {
                        return (
                            <SelectItem key={curr.code} value={curr.code}>
                                <div className="flex items-center gap-2">{formatCurrencyName(curr.code)}</div>
                            </SelectItem>
                        );
                    })}
                </SelectContent>
            </Select>
            <AffixedInput
                prefix={selectedCurrency.symbol}
                value={displayValue}
                onChange={e => onChange(e.target.value)}
                disabled={disabled}
                placeholder="0.00"
                className="pl-8"
                name={name}
            />
        </div>
    );
};

export const TagsInputComponent: DashboardFormComponent = ({ value, onChange, disabled, name, onBlur }) => {
    const [inputValue, setInputValue] = useState('');

    // Parse tags from string value (comma-separated)
    const tags: string[] = value ? value.split(',').filter(Boolean) : [];

    const addTag = (tag: string) => {
        const trimmedTag = tag.trim();
        if (trimmedTag && !tags.includes(trimmedTag)) {
            const newTags = [...tags, trimmedTag];
            onChange(newTags.join(','));
        }
        setInputValue('');
    };

    const removeTag = (tagToRemove: string) => {
        const newTags = tags.filter(tag => tag !== tagToRemove);
        onChange(newTags.join(','));
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addTag(inputValue);
        } else if (e.key === 'Backspace' && inputValue === '' && tags.length > 0) {
            removeTag(tags[tags.length - 1]);
        }
    };

    return (
        <div className="space-y-2">
            {/* Tags Display */}
            <div className="flex flex-wrap gap-1">
                {tags.map((tag, index) => (
                    <Badge key={index} variant="secondary" className="gap-1">
                        {tag}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-4 w-4 p-0 hover:bg-transparent"
                            onClick={() => removeTag(tag)}
                            disabled={disabled}
                        >
                            <X className="h-3 w-3" />
                        </Button>
                    </Badge>
                ))}
            </div>

            {/* Input */}
            <Input
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={onBlur}
                disabled={disabled}
                placeholder="Type a tag and press Enter or comma"
                name={name}
            />
        </div>
    );
};

export const SlugInputComponent: DashboardFormComponent = ({ value, onChange, disabled, name }) => {
    const [autoGenerate, setAutoGenerate] = useState(!value);
    const [isGenerating, setIsGenerating] = useState(false);
    const { watch } = useFormContext();
    const nameValue = watch('translations.0.name');

    const generateSlug = (text: string) => {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9 -]/g, '') // Remove special characters
            .replace(/\s+/g, '-') // Replace spaces with hyphens
            .replace(/-+/g, '-') // Replace multiple hyphens with single
            .trim('-'); // Remove leading/trailing hyphens
    };

    useEffect(() => {
        if (autoGenerate && nameValue) {
            const newSlug = generateSlug(nameValue);
            if (newSlug !== value) {
                onChange(newSlug);
            }
        }
    }, [nameValue, autoGenerate, onChange, value]);

    const handleManualGenerate = async () => {
        if (!nameValue) return;

        setIsGenerating(true);
        // Simulate API call for slug validation/generation
        await new Promise(resolve => setTimeout(resolve, 500));

        const newSlug = generateSlug(nameValue);
        onChange(newSlug);
        setIsGenerating(false);
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center space-x-2">
                <Input
                    value={value || ''}
                    onChange={e => onChange(e.target.value)}
                    disabled={disabled || autoGenerate}
                    placeholder="product-slug"
                    className="flex-1"
                    name={name}
                />

                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={disabled || !nameValue || isGenerating}
                    onClick={handleManualGenerate}
                >
                    <RefreshCw className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
                </Button>
            </div>

            <div className="flex items-center space-x-2">
                <Switch checked={autoGenerate} onCheckedChange={setAutoGenerate} disabled={disabled} />
                <div className="flex items-center space-x-1 text-sm text-muted-foreground">
                    {autoGenerate ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                    <span>Auto-generate from name</span>
                </div>
            </div>
        </div>
    );
};
