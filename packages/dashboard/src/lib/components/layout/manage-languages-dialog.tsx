import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { LanguageSelector } from '@/vdb/components/shared/language-selector.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Label } from '@/vdb/components/ui/label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { Separator } from '@/vdb/components/ui/separator.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { schemaLanguageCodes as globalLanguageCodes } from '@/vdb/graphql/schema-enums.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { useSortedLanguages } from '@/vdb/hooks/use-sorted-languages.js';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from '@/vdb/components/ui/sonner.js';

// GraphQL queries
const globalSettingsLanguagesDocument = graphql(`
    query GlobalSettingsLanguages {
        globalSettings {
            id
            availableLanguages
        }
    }
`);

const updateGlobalSettingsLanguagesDocument = graphql(`
    mutation UpdateGlobalSettingsLanguages($input: UpdateGlobalSettingsInput!) {
        updateGlobalSettings(input: $input) {
            __typename
            ... on GlobalSettings {
                id
                availableLanguages
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

const updateChannelDocument = graphql(`
    mutation UpdateChannelLanguages($input: UpdateChannelInput!) {
        updateChannel(input: $input) {
            __typename
            ... on Channel {
                id
                code
                defaultLanguageCode
                availableLanguageCodes
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

interface ManageLanguagesDialogProps {
    open: boolean;
    onClose: () => void;
}

export function ManageLanguagesDialog({ open, onClose }: ManageLanguagesDialogProps) {
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    const queryClient = useQueryClient();

    const displayChannel = activeChannel;

    // Permission checks
    const canReadGlobalSettings = hasPermissions(['ReadSettings']) || hasPermissions(['ReadGlobalSettings']);
    const canUpdateGlobalSettings =
        hasPermissions(['UpdateSettings']) || hasPermissions(['UpdateGlobalSettings']);
    const canReadChannel = hasPermissions(['ReadChannel']);
    const canUpdateChannel = hasPermissions(['UpdateChannel']);

    // State for managing changes
    const [globalLanguages, setGlobalLanguages] = useState<string[]>([]);
    const [channelLanguages, setChannelLanguages] = useState<string[]>([]);
    const [channelDefaultLanguage, setChannelDefaultLanguage] = useState<string>('');

    // Map and sort channel languages by their formatted names
    const sortedChannelLanguages = useSortedLanguages(channelLanguages || []);

    // Queries
    const {
        data: globalSettingsData,
        isLoading: globalSettingsLoading,
        error: globalSettingsError,
    } = useQuery({
        queryKey: ['globalSettings', 'languages'],
        queryFn: () => api.query(globalSettingsLanguagesDocument),
        enabled: open && canReadGlobalSettings,
    });

    // Mutations
    const updateGlobalSettingsMutation = useMutation({
        mutationFn: (input: { availableLanguages: string[] }) =>
            api.mutate(updateGlobalSettingsLanguagesDocument, { input }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['globalSettings'] });
            queryClient.invalidateQueries({ queryKey: ['getServerConfig'] });
            toast.success('Global language settings updated successfully');
        },
        onError: (error: any) => {
            toast.error(`Failed to update global settings: ${error.message}`);
        },
    });

    const updateChannelMutation = useMutation({
        mutationFn: (input: {
            id: string;
            availableLanguageCodes?: string[];
            defaultLanguageCode?: string;
        }) => api.mutate(updateChannelDocument, { input }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['channels'] });
            queryClient.invalidateQueries({ queryKey: ['activeChannel'] });
            toast.success('Channel language settings updated successfully');
        },
        onError: (error: any) => {
            toast.error(`Failed to update channel settings: ${error.message}`);
        },
    });

    // Initialize state when dialog opens
    useEffect(() => {
        if (open && globalSettingsData) {
            setGlobalLanguages(globalSettingsData.globalSettings.availableLanguages || []);
        }
        if (open && displayChannel) {
            setChannelLanguages(displayChannel.availableLanguageCodes || []);
            setChannelDefaultLanguage(displayChannel.defaultLanguageCode || '');
        }
    }, [open, globalSettingsData, displayChannel]);

    const handleGlobalLanguagesChange = (newLanguages: string[]) => {
        setGlobalLanguages(newLanguages);

        // Remove channel languages that are no longer in global languages
        const updatedChannelLanguages = channelLanguages.filter(lang => newLanguages.includes(lang));
        setChannelLanguages(updatedChannelLanguages);

        // If the default language is no longer available, reset it
        if (!newLanguages.includes(channelDefaultLanguage)) {
            setChannelDefaultLanguage(updatedChannelLanguages[0] || '');
        }
    };

    const handleChannelLanguagesChange = (newLanguages: string[]) => {
        setChannelLanguages(newLanguages);

        // If the default language is no longer available, reset it
        if (!newLanguages.includes(channelDefaultLanguage)) {
            setChannelDefaultLanguage(newLanguages[0] || '');
        }
    };

    const handleSave = async () => {
        const promises = [];

        // Update global settings if changed and permissions allow
        if (canUpdateGlobalSettings && globalSettingsData) {
            const currentGlobalLanguages = globalSettingsData.globalSettings.availableLanguages || [];
            if (JSON.stringify(currentGlobalLanguages.sort()) !== JSON.stringify(globalLanguages.sort())) {
                promises.push(
                    updateGlobalSettingsMutation.mutateAsync({ availableLanguages: globalLanguages }),
                );
            }
        }

        // Update channel settings if changed and permissions allow
        if (canUpdateChannel && displayChannel) {
            const currentChannelLanguages = displayChannel.availableLanguageCodes || [];
            const currentChannelDefault = displayChannel.defaultLanguageCode || '';

            const languagesChanged =
                JSON.stringify(currentChannelLanguages.sort()) !== JSON.stringify(channelLanguages.sort());
            const defaultChanged = currentChannelDefault !== channelDefaultLanguage;

            if (languagesChanged || defaultChanged) {
                promises.push(
                    updateChannelMutation.mutateAsync({
                        id: displayChannel.id,
                        availableLanguageCodes: channelLanguages,
                        defaultLanguageCode: channelDefaultLanguage,
                    }),
                );
            }
        }

        try {
            await Promise.all(promises);
            onClose();
        } catch (error) {
            // Error handling is done in mutation callbacks
        }
    };

    const hasChanges = () => {
        if (globalSettingsData && canUpdateGlobalSettings) {
            const currentGlobal = globalSettingsData.globalSettings.availableLanguages || [];
            if (JSON.stringify(currentGlobal.sort()) !== JSON.stringify(globalLanguages.sort())) {
                return true;
            }
        }

        if (displayChannel && canUpdateChannel) {
            const currentChannelLangs = displayChannel.availableLanguageCodes || [];
            const currentChannelDefault = displayChannel.defaultLanguageCode || '';

            return (
                JSON.stringify(currentChannelLangs.sort()) !== JSON.stringify(channelLanguages.sort()) ||
                currentChannelDefault !== channelDefaultLanguage
            );
        }

        return false;
    };

    const isLoading = updateGlobalSettingsMutation.isPending || updateChannelMutation.isPending;

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Manage Languages</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>Configure available languages for your store and channels</Trans>
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                    {/* Global Settings Section */}
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <h3 className="font-semibold">
                                <Trans>Global Languages</Trans>
                            </h3>
                            {!canReadGlobalSettings && <Lock className="h-4 w-4 text-muted-foreground" />}
                        </div>

                        {!canReadGlobalSettings ? (
                            <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                                <AlertCircle className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">
                                    <Trans>You don't have permission to view global language settings</Trans>
                                </span>
                            </div>
                        ) : globalSettingsLoading ? (
                            <div className="text-sm text-muted-foreground">
                                <Trans>Loading global settings...</Trans>
                            </div>
                        ) : globalSettingsError ? (
                            <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-md">
                                <AlertCircle className="h-4 w-4 text-destructive" />
                                <span className="text-sm text-destructive">
                                    <Trans>Failed to load global settings</Trans>
                                </span>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <Label>
                                    <Trans>Select Available Languages</Trans>
                                </Label>
                                <div
                                    className={
                                        !canUpdateGlobalSettings ? 'pointer-events-none opacity-50' : ''
                                    }
                                >
                                    <LanguageSelector
                                        value={globalLanguages}
                                        onChange={handleGlobalLanguagesChange}
                                        multiple={true}
                                        availableLanguageCodes={globalLanguageCodes}
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    <Trans>These languages will be available for all channels to use</Trans>
                                </p>
                            </div>
                        )}
                    </div>

                    <Separator />

                    {/* Channel Settings Section */}
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <h3 className="font-semibold">
                                <Trans>Channel Languages</Trans> -{' '}
                                <ChannelCodeLabel code={displayChannel?.code} />
                            </h3>
                            {!canReadChannel && <Lock className="h-4 w-4 text-muted-foreground" />}
                        </div>

                        {!canReadChannel ? (
                            <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                                <AlertCircle className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">
                                    <Trans>You don't have permission to view channel settings</Trans>
                                </span>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">
                                        <Trans>Available Languages</Trans>
                                    </Label>
                                    <div
                                        className={!canUpdateChannel ? 'pointer-events-none opacity-50' : ''}
                                    >
                                        <LanguageSelector
                                            value={channelLanguages}
                                            onChange={handleChannelLanguagesChange}
                                            multiple={true}
                                            availableLanguageCodes={globalLanguages}
                                        />
                                    </div>
                                    {globalLanguages.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">
                                            <Trans>No global languages configured</Trans>
                                        </p>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">
                                            <Trans>
                                                Select from globally available languages for this channel
                                            </Trans>
                                        </p>
                                    )}
                                </div>

                                {sortedChannelLanguages.length > 0 && (
                                    <div>
                                        <Label className="text-sm font-medium mb-2 block">
                                            <Trans>Default Language</Trans>
                                        </Label>
                                        <Select
                                            items={Object.fromEntries(sortedChannelLanguages.map(({ code, label }) => [code, `${label} (${code.toUpperCase()})`]))}
                                            value={channelDefaultLanguage}
                                            onValueChange={(value) => { if (value != null) setChannelDefaultLanguage(value) }}
                                            disabled={!canUpdateChannel}
                                        >
                                            <SelectTrigger className="w-[200px]">
                                                <SelectValue placeholder="Select default language" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {sortedChannelLanguages.map(({ code, label }) => (
                                                    <SelectItem key={code} value={code}>
                                                        {label} ({code.toUpperCase()})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isLoading}>
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button onClick={handleSave} disabled={!hasChanges() || isLoading}>
                        {isLoading ? <Trans>Saving...</Trans> : <Trans>Save Changes</Trans>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
