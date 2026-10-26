import { ResetPasswordForm } from '@/vdb/components/login/reset-password-form.js';
import { LoginBranding } from '@/vdb/components/shared/powered-by-vendure.js';
import { useAuth } from '@/vdb/hooks/use-auth.js';
import { z } from '@/vdb/lib/zod.js';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/reset-password')({
    validateSearch: z.object({
        token: z.string().optional().catch(undefined),
    }),
    component: ResetPasswordPage,
});

function ResetPasswordPage() {
    const auth = useAuth();
    const navigate = Route.useNavigate();
    const { token } = Route.useSearch();

    const onSuccess = (identifier: string, password: string) => {
        // The resetPassword mutation has already created a session, but we run
        // the regular login flow so that the auth state, channel token & query
        // cache are all set up in the same way as a normal sign-in.
        auth.login(identifier, password, () => {
            navigate({ to: '/' });
        });
    };

    return (
        <div className="flex min-h-svh flex-col items-center justify-center p-6 md:p-10 bg-sidebar">
            <div className="w-full max-w-sm md:max-w-md">
                <ResetPasswordForm token={token} onSuccess={onSuccess} />
                <LoginBranding />
            </div>
        </div>
    );
}
