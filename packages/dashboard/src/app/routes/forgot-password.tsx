import { ForgotPasswordForm } from '@/vdb/components/login/forgot-password-form.js';
import { LoginBranding } from '@/vdb/components/shared/powered-by-vendure.js';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/forgot-password')({
    component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
    return (
        <div className="flex min-h-svh flex-col items-center justify-center p-6 md:p-10 bg-sidebar">
            <div className="w-full max-w-sm md:max-w-md">
                <ForgotPasswordForm />
                <LoginBranding />
            </div>
        </div>
    );
}
