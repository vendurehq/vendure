import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';

export function DateTime({ value }: Readonly<{ value: string | Date }>) {
    const { formatDate } = useLocalFormat();
    let renderedDate: string;
    let renderedTime: string;
    try {
        renderedDate = formatDate(value);
        renderedTime = formatDate(value, { timeStyle: 'long' });
    } catch (e) {
        renderedDate = value.toString();
        renderedTime = '';
        console.error(e);
    }
    return <div className="flex flex-col">
        <div className="text-sm">{renderedDate}</div>
        <div className="text-xs text-muted-foreground">{renderedTime}</div>
    </div>;
}
