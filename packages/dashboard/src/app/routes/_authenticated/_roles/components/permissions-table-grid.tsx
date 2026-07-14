import { Button } from '@/vdb/components/ui/button.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { Table, TableBody, TableCell, TableRow } from '@/vdb/components/ui/table.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/vdb/components/ui/tooltip.js';
import { useGroupedPermissions } from '@/vdb/hooks/use-grouped-permissions.js';
import { ServerConfig } from '@/vdb/providers/server-config.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { InfoIcon } from 'lucide-react';

interface PermissionsTableGridProps {
    value: string[];
    onChange: (permissions: string[]) => void;
    readonly?: boolean;
}

export function PermissionsTableGrid({
    value,
    onChange,
    readonly = false,
}: Readonly<PermissionsTableGridProps>) {
    const { i18n } = useLingui();
    const groupedPermissions = useGroupedPermissions();

    const setPermission = (permission: string, checked: boolean) => {
        if (readonly) return;

        const newPermissions = checked ? [...value, permission] : value.filter(p => p !== permission);
        onChange(newPermissions);
    };

    const toggleAll = (defs: ServerConfig['permissions']) => {
        if (readonly) return;

        const shouldEnable = defs.some(d => !value.includes(d.name));
        const newPermissions = shouldEnable
            ? [...new Set([...value, ...defs.map(d => d.name)])]
            : value.filter(p => !defs.some(d => d.name === p));
        onChange(newPermissions);
    };

    // Extract CRUD operation from permission name (e.g., "CreateAdministrator" -> "Create")
    const getPermissionLabel = (permission: ServerConfig['permissions'][0], groupLabel: string) => {
        const name = permission.name;
        const crudPrefixes = ['Create', 'Read', 'Update', 'Delete'];

        for (const prefix of crudPrefixes) {
            if (name.startsWith(prefix)) {
                // Check if the rest matches the group name (singular form)
                const remainder = name.substring(prefix.length);
                const groupSingular = groupLabel.replace(/s$/, ''); // Simple singularization
                if (remainder.toLowerCase() === groupSingular.toLowerCase().replace(/\s/g, '')) {
                    return prefix;
                }
            }
        }

        // Fallback to full name if not a CRUD operation
        return i18n.t(name);
    };

    return (
        <div className="w-full">
            {/* Desktop Table View */}
            <div className="hidden md:block border rounded-lg">
                <Table>
                    <TableBody>
                        {groupedPermissions.map((section, index) => (
                            <TableRow key={index} className="hover:bg-transparent">
                                <TableCell className="bg-muted/50 p-3 align-top w-[150px] min-w-[150px] border-r">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-sm">
                                                {i18n.t(section.label)}
                                            </span>
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger render={<InfoIcon className="h-3 w-3 text-muted-foreground" />} />
                                                    <TooltipContent side="right" className="max-w-[250px]">
                                                        <p className="text-xs">
                                                            {i18n.t(section.description)}
                                                        </p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </div>
                                        {section.permissions.length > 1 && !readonly && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => toggleAll(section.permissions)}
                                                className="h-6 px-2 text-xs"
                                            >
                                                <Trans>Toggle all</Trans>
                                            </Button>
                                        )}
                                    </div>
                                </TableCell>
                                {sortPermissions(section.permissions).map((permission, permIndex) => (
                                    <TableCell
                                        key={permission.name}
                                        className="p-2 text-center align-top min-w-[80px]"
                                        colSpan={section.permissions.length === 1 ? 4 : 1}
                                    >
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger render={<div className="flex flex-col items-center space-y-1.5" />}>
                                                        <Switch
                                                            id={`${section.id}-${permission.name}`}
                                                            checked={value.includes(permission.name)}
                                                            onCheckedChange={checked =>
                                                                setPermission(permission.name, checked)
                                                            }
                                                            disabled={readonly}
                                                            className="scale-90"
                                                        />
                                                        <label
                                                            htmlFor={`${section.id}-${permission.name}`}
                                                            className="text-xs text-center cursor-pointer leading-tight"
                                                        >
                                                            {getPermissionLabel(permission, section.label)}
                                                        </label>
                                                </TooltipTrigger>
                                                <TooltipContent side="top" className="max-w-[250px]">
                                                    <div className="text-xs">
                                                        <div className="font-medium">
                                                            {i18n.t(permission.name)}
                                                        </div>
                                                        <div className="text-accent-foreground/70 mt-1">
                                                            {i18n.t(permission.description)}
                                                        </div>
                                                    </div>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </TableCell>
                                ))}
                                {/* Fill remaining columns if less than 4 permissions */}
                                {section.permissions.length < 4 &&
                                    section.permissions.length > 1 &&
                                    Array.from({ length: 4 - section.permissions.length }).map(
                                        (_, fillIndex) => (
                                            <TableCell key={`fill-${fillIndex}`} className="p-3" />
                                        ),
                                    )}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-4">
                {groupedPermissions.map((section, index) => (
                    <div key={index} className="border rounded-lg p-4 bg-card">
                        <div className="mb-3">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="font-semibold text-sm">{i18n.t(section.label)}</span>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger render={<InfoIcon className="h-3 w-3 text-muted-foreground" />} />
                                        <TooltipContent side="right" className="max-w-[250px]">
                                            <p className="text-xs">{i18n.t(section.description)}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                            {section.permissions.length > 1 && !readonly && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => toggleAll(section.permissions)}
                                    className="h-6 px-2 text-xs"
                                >
                                    <Trans>Toggle all</Trans>
                                </Button>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            {sortPermissions(section.permissions).map(permission => (
                                <div
                                    key={permission.name}
                                    className="flex items-center space-x-3 p-2 rounded border"
                                >
                                    <Switch
                                        id={`mobile-${section.id}-${permission.name}`}
                                        checked={value.includes(permission.name)}
                                        onCheckedChange={checked => setPermission(permission.name, checked)}
                                        disabled={readonly}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger render={<label
                                                        htmlFor={`mobile-${section.id}-${permission.name}`}
                                                        className="text-xs cursor-pointer block truncate"
                                                        aria-label={i18n.t(permission.name)}
                                                    />}>
                                                        {getPermissionLabel(permission, section.label)}
                                                </TooltipTrigger>
                                                <TooltipContent side="top" className="max-w-[250px]">
                                                    <div className="text-xs">
                                                        <div className="font-medium">
                                                            {i18n.t(permission.name)}
                                                        </div>
                                                        <div className="text-muted-foreground mt-1">
                                                            {i18n.t(permission.description)}
                                                        </div>
                                                    </div>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Sort permissions in CRUD order
const sortPermissions = (permissions: ServerConfig['permissions']) => {
    const crudOrder = ['Create', 'Read', 'Update', 'Delete'];

    return [...permissions].sort((a, b) => {
        // Find the CRUD prefix for each permission
        const aPrefix = crudOrder.find(prefix => a.name.startsWith(prefix));
        const bPrefix = crudOrder.find(prefix => b.name.startsWith(prefix));

        // If both have CRUD prefixes, sort by CRUD order
        if (aPrefix && bPrefix) {
            return crudOrder.indexOf(aPrefix) - crudOrder.indexOf(bPrefix);
        }

        // If only one has CRUD prefix, put it first
        if (aPrefix && !bPrefix) return -1;
        if (!aPrefix && bPrefix) return 1;

        // Otherwise, keep original order
        return 0;
    });
};
