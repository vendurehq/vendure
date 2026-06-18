import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { useServerConfig } from '@/vdb/hooks/use-server-config.js';
import { useSortedLanguages } from '@/vdb/hooks/use-sorted-languages.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { cn } from '@/vdb/lib/utils.js';

interface ContentLanguageSelectorProps {
    value?: string;
    onChange?: (value: string) => void;
    className?: string;
}

export function ContentLanguageSelector({ value, onChange, className }: ContentLanguageSelectorProps) {
    const serverConfig = useServerConfig();
    const {
        settings: { contentLanguage },
        setContentLanguage,
    } = useUserSettings();

    // Map languages to code and label, then sort by label
    const sortedLanguages = useSortedLanguages(serverConfig?.availableLanguages);

    // If no value is provided but languages are available, use the first language
    const currentValue = contentLanguage;

    return (
        <Select
            items={Object.fromEntries(sortedLanguages.map(({ code, label }) => [code, label]))}
            value={currentValue}
            onValueChange={(value) => {
                if (value != null) {
                    onChange?.(value);
                    setContentLanguage(value);
                }
            }}
        >
            <SelectTrigger className={cn('w-[200px]', className)}>
                <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent>
                {sortedLanguages.map(({ code, label }) => (
                    <SelectItem key={code} value={code}>
                        {label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
