import { Button } from '@/vdb/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/vdb/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/vdb/components/ui/field';
import { Form } from '@/vdb/components/ui/form';
import { Input } from '@/vdb/components/ui/input';
import { Textarea } from '@/vdb/components/ui/textarea';
import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types';
import { handleNestedFormSubmit } from '@/vdb/framework/form-engine/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { ReviewMultiSelect } from './custom-form-components';

const formSchema = z.object({
    title: z.string().min(1, 'Title is required'),
    body: z.string().min(1, 'Body is required'),
});

type FormSchema = z.infer<typeof formSchema>;

export function ReviewSelectWithCreate(props: DashboardFormComponentProps) {
    const form = useForm<FormSchema>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            title: '',
            body: '',
        },
    });

    const onSubmit = (data: FormSchema) => {
        // TODO: Handle form submission
        form.reset();
    };

    return (
        <div>
            <ReviewMultiSelect {...props}></ReviewMultiSelect>
            <Dialog>
                <DialogTrigger render={<Button variant="outline" />}>
                    Create new
                </DialogTrigger>

                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create new review</DialogTitle>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={handleNestedFormSubmit(form, onSubmit)} className="space-y-4">
                            <Controller
                                control={form.control}
                                name="title"
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid || undefined}>
                                        <FieldLabel>Title</FieldLabel>
                                        <Input placeholder="Enter review title" {...field} />
                                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                    </Field>
                                )}
                            />
                            <Controller
                                control={form.control}
                                name="body"
                                render={({ field, fieldState }) => (
                                    <Field data-invalid={fieldState.invalid || undefined}>
                                        <FieldLabel>Body</FieldLabel>
                                        <Textarea
                                            placeholder="Enter review body"
                                            className="min-h-[100px]"
                                            {...field}
                                        />
                                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                    </Field>
                                )}
                            />
                            <div className="flex justify-end gap-2">
                                <Button type="submit">Create Review</Button>
                            </div>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
