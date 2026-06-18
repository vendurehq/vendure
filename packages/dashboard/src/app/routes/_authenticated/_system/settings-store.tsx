import { DataTable } from '@/vdb/components/data-table/data-table.js';
import { CopyableText } from '@/vdb/components/shared/copyable-text.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { Input } from '@/vdb/components/ui/input.js';
import { ScrollArea } from '@/vdb/components/ui/scroll-area.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import {
    FullWidthPageBlock,
    Page,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql, ResultOf } from '@/vdb/graphql/graphql.js';
import { setSettingsStoreValueDocument } from '@/vdb/graphql/settings-store-operations.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ColumnFilter, createColumnHelper } from '@tanstack/react-table';
import { JsonViewer } from '@/vdb/components/data-display/json-viewer.js';
import { Braces } from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

export const Route = createFileRoute('/_authenticated/_system/settings-store')({
    component: SettingsStorePage,
    loader: () => ({ breadcrumb: () => <Trans>Settings Store</Trans> }),
});

const settingsStoreFieldDefinitionsDocument = graphql(`
    query SettingsStoreFieldDefinitions {
        settingsStoreFieldDefinitions {
            key
            scopeType
            readonly
            currentValue
        }
    }
`);

type FieldDefinition = ResultOf<
    typeof settingsStoreFieldDefinitionsDocument
>['settingsStoreFieldDefinitions'][number];

const fieldDefinitionsQueryKey = ['settingsStoreFieldDefinitions'] as const;

const scopeBadgeVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
    GLOBAL: 'default',
    USER: 'secondary',
    CHANNEL: 'outline',
    USER_AND_CHANNEL: 'secondary',
    CUSTOM: 'outline',
};

function ValueCell({ field, onSave }: { field: FieldDefinition; onSave: (value: any) => void }) {
    const value = field.currentValue;
    const isComplex = typeof value === 'object' && value !== null;

    // Complex objects/arrays → dialog with JSON tree viewer/editor
    if (isComplex) {
        return <JsonValueDialog value={value} fieldKey={field.key} readonly={field.readonly} onSave={onSave} />;
    }

    // Readonly simple values → plain text
    if (field.readonly) {
        return <span className="text-muted-foreground">{formatDisplayValue(value)}</span>;
    }

    // Booleans → inline toggle
    if (typeof value === 'boolean') {
        return <Switch checked={value} onCheckedChange={checked => onSave(checked)} />;
    }

    // Strings, numbers, null → inline editable text
    return <InlineEditValue value={value} onSave={onSave} />;
}

function JsonValueDialog({
    value,
    fieldKey,
    readonly,
    onSave,
}: {
    value: any;
    fieldKey: string;
    readonly: boolean;
    onSave: (value: any) => void;
}) {
    const [open, setOpen] = useState(false);
    const editedValueRef = useRef(value);
    const { t } = useLingui();

    const handleSave = () => {
        onSave(editedValueRef.current);
        setOpen(false);
    };

    const preview = JSON.stringify(value);
    const truncated = preview.length > 60 ? preview.slice(0, 60) + '…' : preview;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button variant="outline" size="sm" className="max-w-[300px] justify-start gap-2 font-mono text-xs" />}>
                <Braces className="size-3.5 shrink-0" />
                <span className="truncate">{truncated}</span>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        <code>{fieldKey}</code>
                    </DialogTitle>
                    <DialogDescription>
                        {readonly ? <Trans>This field is readonly</Trans> : <Trans>Edit JSON value</Trans>}
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[500px]">
                    <JsonViewer
                        data={value}
                        viewOnly={readonly}
                        collapse={1}
                        rootFontSize={12}
                        onUpdate={({ newData }) => {
                            editedValueRef.current = newData;
                        }}
                    />
                </ScrollArea>
                {!readonly && (
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            <Trans>Cancel</Trans>
                        </Button>
                        <Button onClick={handleSave}>
                            <Trans>Save</Trans>
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}

function InlineEditValue({ value, onSave }: { value: any; onSave: (value: any) => void }) {
    const { t } = useLingui();
    const [editing, setEditing] = useState(false);
    const currentValueStr = String(value ?? '');
    const [draft, setDraft] = useState(currentValueStr);

    const startEditing = () => {
        setDraft(currentValueStr);
        setEditing(true);
    };

    const handleSave = () => {
        setEditing(false);
        if (draft === currentValueStr) return;
        if (typeof value === 'number') {
            const parsed = Number(draft);
            if (isNaN(parsed)) {
                toast.error(t`Invalid number`);
                return;
            }
            onSave(parsed);
        } else {
            onSave(draft);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        }
        if (e.key === 'Escape') {
            setEditing(false);
        }
    };

    if (!editing) {
        return (
            <button
                type="button"
                onClick={startEditing}
                className="text-left hover:bg-muted rounded px-1 py-0.5 cursor-pointer w-full min-h-[1.5rem]"
            >
                {formatDisplayValue(value)}
            </button>
        );
    }

    return (
        <Input
            autoFocus
            type={typeof value === 'number' ? 'number' : 'text'}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="h-7"
        />
    );
}

function formatDisplayValue(value: any): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
}

function SettingsStorePage() {
    const { t } = useLingui();
    const [search, setSearch] = useState('');
    const [columnFilters, setColumnFilters] = useState<ColumnFilter[]>([]);
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: fieldDefinitionsQueryKey,
        queryFn: () => api.query(settingsStoreFieldDefinitionsDocument),
    });
    const invalidateFieldDefinitions = () => {
        queryClient.invalidateQueries({ queryKey: [...fieldDefinitionsQueryKey] });
    };
    const { mutate: setValue } = useMutation({
        mutationFn: api.mutate(setSettingsStoreValueDocument),
        onSuccess: result => {
            const res = result as ResultOf<typeof setSettingsStoreValueDocument>;
            if (res.setSettingsStoreValue.result) {
                toast.success(t`Value updated`);
                invalidateFieldDefinitions();
            } else {
                toast.error(res.setSettingsStoreValue.error ?? t`Failed to update value`);
            }
        },
    });

    const allFields = data?.settingsStoreFieldDefinitions ?? [];
    const filteredFields = allFields.filter(f => {
        if (search && !f.key.toLowerCase().includes(search.toLowerCase())) return false;
        for (const filter of columnFilters) {
            const values = filter.value as string[];
            if (!values?.length) continue;
            if (filter.id === 'scopeType' && !values.includes(f.scopeType)) return false;
            if (filter.id === 'readonly' && !values.includes(String(f.readonly))) return false;
        }
        return true;
    });

    const columnHelper = createColumnHelper<FieldDefinition>();
    const columns = useMemo(
        () => [
            columnHelper.accessor('key', {
                header: t`Key`,
                cell: ({ row }) => (
                    <CopyableText value={row.original.key}>
                        <code className="text-xs">{row.original.key}</code>
                    </CopyableText>
                ),
            }),
            columnHelper.accessor('currentValue', {
                header: t`Value`,
                cell: ({ row }) => (
                    <ValueCell
                        field={row.original}
                        onSave={newValue =>
                            setValue({
                                input: { key: row.original.key, value: newValue },
                            })
                        }
                    />
                ),
            }),
            columnHelper.accessor('scopeType', {
                header: t`Scope`,
                cell: ({ row }) => (
                    <Badge variant={scopeBadgeVariant[row.original.scopeType] ?? 'outline'}>
                        {row.original.scopeType}
                    </Badge>
                ),
            }),
            columnHelper.accessor('readonly', {
                header: t`Readonly`,
                cell: ({ row }) =>
                    row.original.readonly ? (
                        <Badge variant="secondary">
                            <Trans>Readonly</Trans>
                        </Badge>
                    ) : null,
            }),
        ],
        [t, setValue],
    );

    return (
        <Page pageId="settings-store-list">
            <PageTitle>
                <Trans>Settings Store</Trans>
            </PageTitle>
            <PageLayout>
                <FullWidthPageBlock blockId="list-table">
                    <DataTable
                        onRefresh={invalidateFieldDefinitions}
                        onSearchTermChange={setSearch}
                        onFilterChange={(_table, filters) => setColumnFilters(filters)}
                        facetedFilters={{
                            scopeType: {
                                title: t`Scope`,
                                options: [
                                    { label: 'Global', value: 'GLOBAL' },
                                    { label: 'User', value: 'USER' },
                                    { label: 'Channel', value: 'CHANNEL' },
                                    { label: 'User & Channel', value: 'USER_AND_CHANNEL' },
                                    { label: 'Custom', value: 'CUSTOM' },
                                ],
                            },
                            readonly: {
                                title: t`Readonly`,
                                options: [
                                    { label: t`Yes`, value: 'true' },
                                    { label: t`No`, value: 'false' },
                                ],
                            },
                        }}
                        isLoading={isLoading}
                        columns={columns}
                        data={filteredFields}
                        totalItems={filteredFields.length}
                    />
                </FullWidthPageBlock>
            </PageLayout>
        </Page>
    );
}
