import { useRoles } from '@/vdb/hooks/use-roles.js';
import { useLingui } from '@lingui/react/macro';
import { MultiSelect } from './multi-select.js';

export interface RoleSelectorProps<T extends boolean> {
    value: T extends true ? string[] : string;
    onChange: (value: T extends true ? string[] : string) => void;
    multiple?: T;
    /**
     * Role ids to omit from the list, e.g. roles already selected elsewhere in the same form.
     */
    excludeIds?: string[];
}

export function RoleSelector<T extends boolean>(props: RoleSelectorProps<T>) {
    const { value, onChange, multiple, excludeIds } = props;
    const { t } = useLingui();

    const { roles } = useRoles();

    const items = roles
        .filter(role => !excludeIds?.includes(role.id))
        .map(role => ({
            value: role.id,
            label: role.code,
            display: role.description ? role.description : role.code,
        }));

    return (
        <MultiSelect
            value={value}
            onChange={onChange}
            multiple={multiple}
            items={items}
            placeholder={t`Select a role`}
            searchPlaceholder={t`Search roles...`}
        />
    );
}
