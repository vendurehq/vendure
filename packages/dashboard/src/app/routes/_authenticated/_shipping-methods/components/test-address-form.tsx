import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { AccordionContent, AccordionItem, AccordionTrigger } from '@/vdb/components/ui/accordion.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { LS_KEY_SHIPPING_TEST_ADDRESS } from '@/vdb/constants.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';

// Query document to fetch available countries
const getAvailableCountriesDocument = graphql(`
    query GetAvailableCountries {
        countries(options: { filter: { enabled: { eq: true } } }) {
            items {
                id
                code
                name
            }
        }
    }
`);

export interface TestAddress {
    fullName: string;
    company?: string;
    streetLine1: string;
    streetLine2?: string;
    city: string;
    province: string;
    postalCode: string;
    countryCode: string;
    phoneNumber?: string;
}

interface TestAddressFormProps {
    onAddressChange: (address: TestAddress) => void;
}

export function TestAddressForm({ onAddressChange }: Readonly<TestAddressFormProps>) {
    const form = useForm<TestAddress>({
        defaultValues: (() => {
            try {
                const stored = localStorage.getItem(LS_KEY_SHIPPING_TEST_ADDRESS);
                return stored
                    ? JSON.parse(stored)
                    : {
                          fullName: '',
                          company: '',
                          streetLine1: '',
                          streetLine2: '',
                          city: '',
                          province: '',
                          postalCode: '',
                          countryCode: '',
                          phoneNumber: '',
                      };
            } catch {
                return {
                    fullName: '',
                    company: '',
                    streetLine1: '',
                    streetLine2: '',
                    city: '',
                    province: '',
                    postalCode: '',
                    countryCode: '',
                    phoneNumber: '',
                };
            }
        })(),
    });

    // Fetch available countries
    const { data: countriesData, isLoading: isLoadingCountries } = useQuery({
        queryKey: ['availableCountries'],
        queryFn: () => api.query(getAvailableCountriesDocument),
        staleTime: 1000 * 60 * 60 * 24, // 24 hours
    });

    const previousValuesRef = useRef<string>('');

    // Use form subscription instead of watch() to avoid infinite loops
    useEffect(() => {
        const subscription = form.watch(value => {
            const currentValueString = JSON.stringify(value);

            // Only update if values actually changed
            if (currentValueString !== previousValuesRef.current) {
                previousValuesRef.current = currentValueString;

                try {
                    localStorage.setItem(LS_KEY_SHIPPING_TEST_ADDRESS, currentValueString);
                } catch {
                    // Ignore localStorage errors
                }

                if (value) {
                    onAddressChange(value as TestAddress);
                }
            }
        });

        return () => subscription.unsubscribe();
    }, [form, onAddressChange]);

    useEffect(() => {
        const initialAddress = form.getValues();
        onAddressChange(initialAddress);
    }, []);

    const currentValues = form.getValues();

    const getAddressSummary = () => {
        const parts = [
            currentValues.fullName,
            currentValues.streetLine1,
            currentValues.city,
            currentValues.province,
            currentValues.postalCode,
            currentValues.countryCode,
        ].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : '';
    };

    const isComplete = !!(
        currentValues.fullName &&
        currentValues.streetLine1 &&
        currentValues.city &&
        currentValues.province &&
        currentValues.postalCode &&
        currentValues.countryCode
    );

    return (
        <AccordionItem value="shipping-address">
            <AccordionTrigger>
                <div className="flex items-center justify-between w-full pr-2">
                    <span>
                        <Trans>Shipping Address</Trans>
                    </span>
                    {isComplete && (
                        <span className="text-sm text-muted-foreground truncate max-w-md">
                            {getAddressSummary()}
                        </span>
                    )}
                </div>
            </AccordionTrigger>
            <AccordionContent className="px-2">
                <Form {...form}>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <FormFieldWrapper
                                control={form.control}
                                name="fullName"
                                label={<Trans>Full Name</Trans>}
                                render={({ field }) => <Input {...field} placeholder="John Smith" />}
                            />
                            <FormFieldWrapper
                                control={form.control}
                                name="company"
                                label={<Trans>Company</Trans>}
                                render={({ field }) => (
                                    <Input {...field} value={field.value || ''} placeholder="Company name" />
                                )}
                            />
                        </div>

                        <FormFieldWrapper
                            control={form.control}
                            name="streetLine1"
                            label={<Trans>Street Address</Trans>}
                            render={({ field }) => <Input {...field} placeholder="123 Main Street" />}
                        />

                        <FormFieldWrapper
                            control={form.control}
                            name="streetLine2"
                            label={<Trans>Street Address 2</Trans>}
                            render={({ field }) => (
                                <Input
                                    {...field}
                                    value={field.value || ''}
                                    placeholder="Apartment, suite, etc."
                                />
                            )}
                        />

                        <div className="grid grid-cols-3 gap-4">
                            <FormFieldWrapper
                                control={form.control}
                                name="city"
                                label={<Trans>City</Trans>}
                                render={({ field }) => <Input {...field} placeholder="New York" />}
                            />
                            <FormFieldWrapper
                                control={form.control}
                                name="province"
                                label={<Trans>State / Province</Trans>}
                                render={({ field }) => <Input {...field} placeholder="NY" />}
                            />
                            <FormFieldWrapper
                                control={form.control}
                                name="postalCode"
                                label={<Trans>Postal Code</Trans>}
                                render={({ field }) => <Input {...field} placeholder="10001" />}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <FormFieldWrapper
                                control={form.control}
                                name="countryCode"
                                label={<Trans>Country</Trans>}
                                renderFormControl={false}
                                render={({ field }) => (
                                    <Select
                                        items={countriesData ? Object.fromEntries(countriesData.countries.items.map(c => [c.code, c.name])) : {}}
                                        onValueChange={field.onChange}
                                        value={field.value}
                                        disabled={isLoadingCountries}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a country" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {countriesData?.countries.items.map(country => (
                                                <SelectItem key={country.code} value={country.code}>
                                                    {country.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                            <FormFieldWrapper
                                control={form.control}
                                name="phoneNumber"
                                label={<Trans>Phone Number</Trans>}
                                render={({ field }) => (
                                    <Input
                                        {...field}
                                        value={field.value || ''}
                                        placeholder="+1 (555) 123-4567"
                                    />
                                )}
                            />
                        </div>
                    </div>
                </Form>
            </AccordionContent>
        </AccordionItem>
    );
}
