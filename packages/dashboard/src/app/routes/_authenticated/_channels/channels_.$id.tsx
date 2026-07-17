import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { CurrencySelector } from '@/vdb/components/shared/currency-selector.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { LanguageSelector } from '@/vdb/components/shared/language-selector.js';
import { SellerSelector } from '@/vdb/components/shared/seller-selector.js';
import { ZoneSelector } from '@/vdb/components/shared/zone-selector.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { DEFAULT_CHANNEL_CODE, NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import {
    CustomFieldsPageBlock,
    DetailFormGrid,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { detailPageRouteLoader } from '@/vdb/framework/page/detail-page-route-loader.js';
import { useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { z } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { channelDetailDocument, createChannelDocument, updateChannelDocument } from './channels.graphql.js';

const pageId = 'channel-detail';

/**
 * The available language codes sent to the server, or `undefined` when the user selected none.
 *
 * Omitting an empty list lets ChannelService.create derive it from the default
 * (`input.availableLanguageCodes ?? [defaultLanguageCode]`) — as opposed to `[]`, which would be
 * saved as a channel with no available languages at all. `defaultLanguageCode` is pre-filled from
 * the active channel, so an empty list here is the normal state of an untouched create form.
 *
 * A non-empty list must contain the default: neither `create` nor `update` checks that it does for
 * languages, so a default outside the list would be saved as an unusable channel.
 *
 * Currencies need none of this: the default currency can only be picked from the available
 * currencies, and that pair is validated below, so the list is always non-empty and always
 * contains the default by the time it is submitted.
 */
function withDefaultLanguage<T extends string>(
    available: readonly T[] | null | undefined,
    defaultCode: T | null | undefined,
): T[] | undefined {
    if (!available?.length) {
        return undefined;
    }
    return [...new Set(defaultCode ? [...available, defaultCode] : available)];
}

export const Route = createFileRoute('/_authenticated/_channels/channels_/$id')({
    component: ChannelDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: channelDetailDocument,
        breadcrumb(isNew, entity) {
            return [
                { path: '/channels', label: <Trans>Channels</Trans> },
                isNew ? <Trans>New channel</Trans> : <ChannelCodeLabel code={entity?.code ?? ''} />,
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function ChannelDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const { refreshChannels } = useChannel();

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: channelDetailDocument,
        createDocument: createChannelDocument,
        updateDocument: updateChannelDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                code: entity.code,
                token: entity.token,
                pricesIncludeTax: entity.pricesIncludeTax,
                availableCurrencyCodes: entity.availableCurrencyCodes,
                availableLanguageCodes: entity.availableLanguageCodes,
                defaultCurrencyCode: entity.defaultCurrencyCode,
                defaultLanguageCode: entity.defaultLanguageCode,
                defaultShippingZoneId: entity.defaultShippingZone?.id,
                defaultTaxZoneId: entity.defaultTaxZone?.id,
                sellerId: entity.seller?.id,
                customFields: entity.customFields,
            };
        },
        transformCreateInput: input => {
            return {
                ...input,
                currencyCode: undefined,
                availableLanguageCodes: withDefaultLanguage(
                    input.availableLanguageCodes,
                    input.defaultLanguageCode,
                ),
            };
        },
        transformUpdateInput: input => {
            return {
                ...input,
                availableLanguageCodes: withDefaultLanguage(
                    input.availableLanguageCodes,
                    input.defaultLanguageCode,
                ),
            };
        },
        // The generated schema is derived from the GraphQL input type, which only tells us about
        // nullability — `String!` still permits '', an unfilled `ID!` relation is seeded with '',
        // and a nullable field can still be required by the server. None of those make a valid
        // channel, so the fields the user must actually supply are declared here.
        //
        // These are only enforced on create: `UpdateChannelInput` makes every field optional and
        // omits what isn't sent, so an update may legitimately touch just one field.
        extendSchema: schema =>
            schema
                .extend({
                    code: z.string().min(1, { message: t`This field is required` }),
                    token: z.string().min(1, { message: t`This field is required` }),
                    ...(creatingNewEntity
                        ? {
                              defaultTaxZoneId: z.string().min(1, { message: t`This field is required` }),
                              defaultShippingZoneId: z.string().min(1, { message: t`This field is required` }),
                          }
                        : {}),
                })
                // The currency pair is checked together, because whether a default is valid depends
                // entirely on the available list it has to come from. `defaultCurrencyCode` is
                // nullable in the schema but ChannelService.create throws a raw UserInputError
                // unless it is given (this page always sends `currencyCode: undefined`), and a
                // supplied available list is saved verbatim without checking it contains the
                // default — so both halves have to be caught here.
                //
                // Unlike the fields above this is not limited to create: an existing channel always
                // has both, so an update can only reach these states by actively breaking them.
                .superRefine((values, ctx) => {
                    const available: string[] = values.availableCurrencyCodes ?? [];
                    const addIssue = (path: string, message: string) =>
                        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

                    if (!available.length) {
                        // Nothing is available, so the default cannot be filled in yet — say so on
                        // both fields rather than only on the one that happens to be required.
                        addIssue('availableCurrencyCodes', t`You must select at least one available currency`);
                        addIssue(
                            'defaultCurrencyCode',
                            t`You must first select an available currency to set a default currency`,
                        );
                    } else if (!available.includes(values.defaultCurrencyCode as string)) {
                        // There is a list to pick from: either nothing was picked, or the list was
                        // narrowed afterwards and dropped the default.
                        addIssue(
                            'defaultCurrencyCode',
                            t`You must select a default currency from the list of available currencies`,
                        );
                    }
                }),
        params: { id: params.id },
        onSuccess: async data => {
            if (data.__typename === 'Channel') {
                toast(creatingNewEntity ? t`Successfully created channel` : t`Successfully updated channel`);
                refreshChannels();
                resetForm();
                if (creatingNewEntity) {
                    await navigate({ to: `../$id`, params: { id: data.id } });
                }
            } else {
                toast(creatingNewEntity ? t`Failed to create channel` : t`Failed to update channel`, {
                    description: data.message,
                });
            }
        },
        onError: err => {
            toast(creatingNewEntity ? t`Failed to create channel` : t`Failed to update channel`, {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    const availableCurrencyCodes = form.watch('availableCurrencyCodes');
    const availableLanguageCodes = form.watch('availableLanguageCodes');

    const codeIsDefault = entity?.code === DEFAULT_CHANNEL_CODE;

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>
                {creatingNewEntity ? (
                    <Trans>New channel</Trans>
                ) : (
                    <ChannelCodeLabel code={entity?.code ?? ''} />
                )}
            </PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="save-button" requiresPermission={['UpdateChannel']}>
                    {/*
                     * Deliberately not gated on `formState.isValid`: with required fields, an
                     * untouched invalid form would leave the button disabled with no indication
                     * of why. `submitHandler` validates and bails, surfacing inline field errors.
                     */}
                    <Button type="submit" disabled={!form.formState.isDirty || isPending}>
                        {creatingNewEntity ? <Trans>Create</Trans> : <Trans>Update</Trans>}
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="code"
                            label={<Trans>Code</Trans>}
                            render={({ field }) => (
                                <Input placeholder="" {...field} disabled={codeIsDefault} />
                            )}
                        />
                        <div></div>
                        <FormFieldWrapper
                            control={form.control}
                            name="token"
                            label={<Trans>Token</Trans>}
                            description={
                                <Trans>
                                    The token is used to specify the channel when making API requests.
                                </Trans>
                            }
                            render={({ field }) => <Input placeholder="" {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="sellerId"
                            label={<Trans>Seller</Trans>}
                            render={({ field }) => (
                                <SellerSelector value={field.value ?? ''} onChange={field.onChange} />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="availableLanguageCodes"
                            label={<Trans>Available languages</Trans>}
                            description={<Trans>Defaults to the default language.</Trans>}
                            render={({ field }) => (
                                <LanguageSelector
                                    value={field.value ?? []}
                                    onChange={field.onChange}
                                    multiple={true}
                                />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="availableCurrencyCodes"
                            label={<Trans>Available currencies</Trans>}
                            description={<Trans>The default currency is chosen from this list.</Trans>}
                            render={({ field }) => (
                                <CurrencySelector
                                    value={field.value ?? []}
                                    onChange={field.onChange}
                                    multiple={true}
                                />
                            )}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <PageBlock column="main" blockId="channel-defaults" title={<Trans>Channel defaults</Trans>}>
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="defaultLanguageCode"
                            label={<Trans>Default language</Trans>}
                            render={({ field }) => (
                                <LanguageSelector
                                    value={field.value ?? ''}
                                    onChange={field.onChange}
                                    multiple={false}
                                    // Unlike the currency below, this cannot narrow to an empty
                                    // available list: `defaultLanguageCode` is non-nullable and
                                    // pre-filled from the active channel, so an empty list would
                                    // leave a required field showing a value its own selector no
                                    // longer offers. The current value is always included for the
                                    // same reason — it is submitted as available regardless.
                                    availableLanguageCodes={withDefaultLanguage(
                                        availableLanguageCodes,
                                        field.value,
                                    )}
                                />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="defaultCurrencyCode"
                            label={<Trans>Default currency</Trans>}
                            render={({ field }) => (
                                <CurrencySelector
                                    value={field.value ?? ''}
                                    onChange={field.onChange}
                                    multiple={false}
                                    // The available currencies are the only currencies to pick
                                    // from, including none at all: with an empty list this
                                    // selector is deliberately empty, so a default cannot be
                                    // chosen before the list it must belong to.
                                    availableCurrencyCodes={availableCurrencyCodes ?? []}
                                />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="defaultTaxZoneId"
                            label={<Trans>Default tax zone</Trans>}
                            render={({ field }) => (
                                <ZoneSelector value={field.value ?? ''} onChange={field.onChange} />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="defaultShippingZoneId"
                            label={<Trans>Default shipping zone</Trans>}
                            render={({ field }) => (
                                <ZoneSelector value={field.value ?? ''} onChange={field.onChange} />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="pricesIncludeTax"
                            label={<Trans>Prices include tax for default tax zone</Trans>}
                            description={
                                <Trans>
                                    When this is enabled, the prices entered in the product catalog will be
                                    included in the tax for the default tax zone.
                                </Trans>
                            }
                            render={({ field }) => (
                                <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                            )}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Channel" control={form.control} />
            </PageLayout>
        </Page>
    );
}
