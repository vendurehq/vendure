import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/vdb/components/ui/select.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '../ui/skeleton.js';

const zonesDocument = graphql(`
    query Zones($options: ZoneListOptions) {
        zones(options: $options) {
            items {
                id
                name
            }
        }
    }
`);

export interface ZoneSelectorProps {
    value: string | undefined;
    onChange: (value: string) => void;
}

export function ZoneSelector({ value, onChange }: Readonly<ZoneSelectorProps>) {
    const { data, isLoading, isPending } = useQuery({
        queryKey: ['zones'],
        staleTime: 1000 * 60 * 5,
        queryFn: () =>
            api.query(zonesDocument, {
                options: {
                    take: 100,
                },
            }),
    });

    if (isLoading || isPending) {
        return <Skeleton className="h-10 w-full" />;
    }

    return (
        <Select items={data ? Object.fromEntries(data.zones.items.map(z => [z.id, z.name])) : {}} value={value ?? ''} onValueChange={value => value && onChange(value)}>
            <SelectTrigger>
                <SelectValue placeholder={<Trans>Select a zone</Trans>}>
                    {(val: string) => data?.zones.items.find(z => z.id === val)?.name}
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                {data && (
                    <SelectGroup>
                        {data?.zones.items.map(zone => (
                            <SelectItem key={zone.id} value={zone.id}>
                                {zone.name}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                )}
            </SelectContent>
        </Select>
    );
}
