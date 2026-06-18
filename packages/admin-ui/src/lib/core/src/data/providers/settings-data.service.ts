import { FetchPolicy, WatchQueryFetchPolicy } from '@apollo/client/core';
import { pick } from '@vendure/common/lib/pick';

import * as Codegen from '../../common/generated-types';
import {
    ChannelListOptions,
    JobListOptions,
    JobState,
    SellerListOptions,
    TaxCategoryListOptions,
} from '../../common/generated-types';
import {
    ADD_MEMBERS_TO_ZONE,
    CANCEL_JOB,
    CREATE_CHANNEL,
    CREATE_COUNTRY,
    CREATE_PAYMENT_METHOD,
    CREATE_SELLER,
    CREATE_TAX_CATEGORY,
    CREATE_TAX_RATE,
    CREATE_ZONE,
    DELETE_CHANNEL,
    DELETE_CHANNELS,
    DELETE_COUNTRIES,
    DELETE_COUNTRY,
    DELETE_PAYMENT_METHOD,
    DELETE_PAYMENT_METHODS,
    DELETE_SELLER,
    DELETE_SELLERS,
    DELETE_TAX_CATEGORIES,
    DELETE_TAX_CATEGORY,
    DELETE_TAX_RATE,
    DELETE_TAX_RATES,
    DELETE_ZONE,
    DELETE_ZONES,
    GET_ACTIVE_CHANNEL,
    GET_AVAILABLE_COUNTRIES,
    GET_CHANNELS,
    GET_GLOBAL_SETTINGS,
    GET_JOB_INFO,
    GET_JOB_QUEUE_LIST,
    GET_JOBS_BY_ID,
    GET_JOBS_LIST,
    GET_PAYMENT_METHOD_OPERATIONS,
    GET_SELLERS,
    GET_TAX_CATEGORIES,
    GET_TAX_RATE_LIST_SIMPLE,
    GET_ZONE,
    REMOVE_MEMBERS_FROM_ZONE,
    UPDATE_CHANNEL,
    UPDATE_COUNTRY,
    UPDATE_GLOBAL_SETTINGS,
    UPDATE_PAYMENT_METHOD,
    UPDATE_SELLER,
    UPDATE_TAX_CATEGORY,
    UPDATE_TAX_RATE,
    UPDATE_ZONE,
} from '../definitions/settings-definitions';

import { BaseDataService } from './base-data.service';

export class SettingsDataService {
    constructor(private baseDataService: BaseDataService) {}

    getAvailableCountries() {
        return this.baseDataService.query<Codegen.GetAvailableCountriesQuery>(GET_AVAILABLE_COUNTRIES);
    }

    createCountry(input: Codegen.CreateCountryInput) {
        return this.baseDataService.mutate<
            Codegen.CreateCountryMutation,
            Codegen.CreateCountryMutationVariables
        >(CREATE_COUNTRY, {
            input: pick(input, ['code', 'enabled', 'translations', 'customFields']),
        });
    }

    updateCountry(input: Codegen.UpdateCountryInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateCountryMutation,
            Codegen.UpdateCountryMutationVariables
        >(UPDATE_COUNTRY, {
            input: pick(input, ['id', 'code', 'enabled', 'translations', 'customFields']),
        });
    }

    deleteCountry(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteCountryMutation,
            Codegen.DeleteCountryMutationVariables
        >(DELETE_COUNTRY, {
            id,
        });
    }

    deleteCountries(ids: string[]) {
        return this.baseDataService.mutate<
            Codegen.DeleteCountriesMutation,
            Codegen.DeleteCountriesMutationVariables
        >(DELETE_COUNTRIES, {
            ids,
        });
    }

    getZone(id: string) {
        return this.baseDataService.query<Codegen.GetZoneQuery, Codegen.GetZoneQueryVariables>(GET_ZONE, {
            id,
        });
    }

    createZone(input: Codegen.CreateZoneInput) {
        return this.baseDataService.mutate<Codegen.CreateZoneMutation, Codegen.CreateZoneMutationVariables>(
            CREATE_ZONE,
            {
                input,
            },
        );
    }

    updateZone(input: Codegen.UpdateZoneInput) {
        return this.baseDataService.mutate<Codegen.UpdateZoneMutation, Codegen.UpdateZoneMutationVariables>(
            UPDATE_ZONE,
            {
                input,
            },
        );
    }

    deleteZone(id: string) {
        return this.baseDataService.mutate<Codegen.DeleteZoneMutation, Codegen.DeleteZoneMutationVariables>(
            DELETE_ZONE,
            {
                id,
            },
        );
    }

    deleteZones(ids: string[]) {
        return this.baseDataService.mutate<Codegen.DeleteZonesMutation, Codegen.DeleteZonesMutationVariables>(
            DELETE_ZONES,
            {
                ids,
            },
        );
    }

    addMembersToZone(zoneId: string, memberIds: string[]) {
        return this.baseDataService.mutate<
            Codegen.AddMembersToZoneMutation,
            Codegen.AddMembersToZoneMutationVariables
        >(ADD_MEMBERS_TO_ZONE, {
            zoneId,
            memberIds,
        });
    }

    removeMembersFromZone(zoneId: string, memberIds: string[]) {
        return this.baseDataService.mutate<
            Codegen.RemoveMembersFromZoneMutation,
            Codegen.RemoveMembersFromZoneMutationVariables
        >(REMOVE_MEMBERS_FROM_ZONE, {
            zoneId,
            memberIds,
        });
    }

    getTaxCategories(options: TaxCategoryListOptions = {}) {
        return this.baseDataService.query<
            Codegen.GetTaxCategoriesQuery,
            Codegen.GetTaxCategoriesQueryVariables
        >(GET_TAX_CATEGORIES, {
            options,
        });
    }

    createTaxCategory(input: Codegen.CreateTaxCategoryInput) {
        return this.baseDataService.mutate<
            Codegen.CreateTaxCategoryMutation,
            Codegen.CreateTaxCategoryMutationVariables
        >(CREATE_TAX_CATEGORY, {
            input,
        });
    }

    updateTaxCategory(input: Codegen.UpdateTaxCategoryInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateTaxCategoryMutation,
            Codegen.UpdateTaxCategoryMutationVariables
        >(UPDATE_TAX_CATEGORY, {
            input,
        });
    }

    deleteTaxCategory(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteTaxCategoryMutation,
            Codegen.DeleteTaxCategoryMutationVariables
        >(DELETE_TAX_CATEGORY, {
            id,
        });
    }

    deleteTaxCategories(ids: string[]) {
        return this.baseDataService.mutate<
            Codegen.DeleteTaxCategoriesMutation,
            Codegen.DeleteTaxCategoriesMutationVariables
        >(DELETE_TAX_CATEGORIES, {
            ids,
        });
    }

    getTaxRatesSimple(take = 10, skip = 0, fetchPolicy?: FetchPolicy) {
        return this.baseDataService.query<
            Codegen.GetTaxRateListSimpleQuery,
            Codegen.GetTaxRateListSimpleQueryVariables
        >(
            GET_TAX_RATE_LIST_SIMPLE,
            {
                options: {
                    take,
                    skip,
                },
            },
            fetchPolicy,
        );
    }

    createTaxRate(input: Codegen.CreateTaxRateInput) {
        return this.baseDataService.mutate<
            Codegen.CreateTaxRateMutation,
            Codegen.CreateTaxRateMutationVariables
        >(CREATE_TAX_RATE, {
            input,
        });
    }

    updateTaxRate(input: Codegen.UpdateTaxRateInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateTaxRateMutation,
            Codegen.UpdateTaxRateMutationVariables
        >(UPDATE_TAX_RATE, {
            input,
        });
    }

    deleteTaxRate(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteTaxRateMutation,
            Codegen.DeleteTaxRateMutationVariables
        >(DELETE_TAX_RATE, {
            id,
        });
    }

    deleteTaxRates(ids: string[]) {
        return this.baseDataService.mutate<
            Codegen.DeleteTaxRatesMutation,
            Codegen.DeleteTaxRatesMutationVariables
        >(DELETE_TAX_RATES, {
            ids,
        });
    }

    getChannels(options: ChannelListOptions = {}) {
        return this.baseDataService.query<Codegen.GetChannelsQuery, Codegen.GetChannelsQueryVariables>(
            GET_CHANNELS,
            { options },
        );
    }

    getSellerList(options?: SellerListOptions) {
        return this.baseDataService.query<Codegen.GetSellersQuery, Codegen.GetSellersQueryVariables>(
            GET_SELLERS,
            { options },
        );
    }

    createSeller(input: Codegen.CreateSellerInput) {
        return this.baseDataService.mutate<
            Codegen.CreateSellerMutation,
            Codegen.CreateSellerMutationVariables
        >(CREATE_SELLER, {
            input,
        });
    }

    updateSeller(input: Codegen.UpdateSellerInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateSellerMutation,
            Codegen.UpdateSellerMutationVariables
        >(UPDATE_SELLER, {
            input,
        });
    }

    deleteSeller(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteSellerMutation,
            Codegen.DeleteSellerMutationVariables
        >(DELETE_SELLER, {
            id,
        });
    }

    deleteSellers(ids: string[]) {
        return this.baseDataService.mutate<
            Codegen.DeleteSellersMutation,
            Codegen.DeleteSellersMutationVariables
        >(DELETE_SELLERS, {
            ids,
        });
    }

    getActiveChannel(fetchPolicy?: FetchPolicy) {
        return this.baseDataService.query<
            Codegen.GetActiveChannelQuery,
            Codegen.GetActiveChannelQueryVariables
        >(GET_ACTIVE_CHANNEL, {}, fetchPolicy);
    }

    createChannel(input: Codegen.CreateChannelInput) {
        return this.baseDataService.mutate<
            Codegen.CreateChannelMutation,
            Codegen.CreateChannelMutationVariables
        >(CREATE_CHANNEL, {
            input,
        });
    }

    updateChannel(input: Codegen.UpdateChannelInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateChannelMutation,
            Codegen.UpdateChannelMutationVariables
        >(UPDATE_CHANNEL, {
            input,
        });
    }

    deleteChannel(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteChannelMutation,
            Codegen.DeleteChannelMutationVariables
        >(DELETE_CHANNEL, {
            id,
        });
    }

    deleteChannels(ids: string[]) {
        return this.baseDataService.mutate<
            Codegen.DeleteChannelsMutation,
            Codegen.DeleteChannelsMutationVariables
        >(DELETE_CHANNELS, {
            ids,
        });
    }

    createPaymentMethod(input: Codegen.CreatePaymentMethodInput) {
        return this.baseDataService.mutate<
            Codegen.CreatePaymentMethodMutation,
            Codegen.CreatePaymentMethodMutationVariables
        >(CREATE_PAYMENT_METHOD, {
            input: pick(input, ['code', 'checker', 'handler', 'enabled', 'translations', 'customFields']),
        });
    }

    updatePaymentMethod(input: Codegen.UpdatePaymentMethodInput) {
        return this.baseDataService.mutate<
            Codegen.UpdatePaymentMethodMutation,
            Codegen.UpdatePaymentMethodMutationVariables
        >(UPDATE_PAYMENT_METHOD, {
            input: pick(input, [
                'id',
                'code',
                'checker',
                'handler',
                'enabled',
                'translations',
                'customFields',
            ]),
        });
    }

    deletePaymentMethod(id: string, force: boolean) {
        return this.baseDataService.mutate<
            Codegen.DeletePaymentMethodMutation,
            Codegen.DeletePaymentMethodMutationVariables
        >(DELETE_PAYMENT_METHOD, {
            id,
            force,
        });
    }

    deletePaymentMethods(ids: string[], force: boolean) {
        return this.baseDataService.mutate<
            Codegen.DeletePaymentMethodsMutation,
            Codegen.DeletePaymentMethodsMutationVariables
        >(DELETE_PAYMENT_METHODS, {
            ids,
            force,
        });
    }

    getPaymentMethodOperations() {
        return this.baseDataService.query<Codegen.GetPaymentMethodOperationsQuery>(
            GET_PAYMENT_METHOD_OPERATIONS,
        );
    }

    getGlobalSettings(fetchPolicy?: WatchQueryFetchPolicy) {
        return this.baseDataService.query<Codegen.GetGlobalSettingsQuery>(
            GET_GLOBAL_SETTINGS,
            undefined,
            fetchPolicy,
        );
    }

    updateGlobalSettings(input: Codegen.UpdateGlobalSettingsInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateGlobalSettingsMutation,
            Codegen.UpdateGlobalSettingsMutationVariables
        >(UPDATE_GLOBAL_SETTINGS, {
            input,
        });
    }

    getJob(id: string) {
        return this.baseDataService.query<Codegen.GetJobInfoQuery, Codegen.GetJobInfoQueryVariables>(
            GET_JOB_INFO,
            {
                id,
            },
        );
    }

    pollJobs(ids: string[]) {
        return this.baseDataService.query<Codegen.GetJobsByIdQuery, Codegen.GetJobsByIdQueryVariables>(
            GET_JOBS_BY_ID,
            {
                ids,
            },
        );
    }

    getAllJobs(options?: JobListOptions) {
        return this.baseDataService.query<Codegen.GetAllJobsQuery, Codegen.GetAllJobsQueryVariables>(
            GET_JOBS_LIST,
            {
                options,
            },
            'cache-first',
        );
    }

    getJobQueues() {
        return this.baseDataService.query<Codegen.GetJobQueueListQuery>(GET_JOB_QUEUE_LIST);
    }

    getRunningJobs() {
        return this.baseDataService.query<Codegen.GetAllJobsQuery, Codegen.GetAllJobsQueryVariables>(
            GET_JOBS_LIST,
            {
                options: {
                    filter: {
                        state: {
                            eq: JobState.RUNNING,
                        },
                    },
                },
            },
        );
    }

    cancelJob(id: string) {
        return this.baseDataService.mutate<Codegen.CancelJobMutation, Codegen.CancelJobMutationVariables>(
            CANCEL_JOB,
            {
                id,
            },
        );
    }
}
