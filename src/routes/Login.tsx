import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Package } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(6, 'At least 6 characters'),
});
type FormData = z.infer<typeof schema>;

export function LoginPage() {
  const { user, isAdmin, loading, signIn } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  if (!loading && user && isAdmin) return <Navigate to={from} replace />;

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    try {
      await signIn(data.email, data.password);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign in failed';
      toast.error(msg.replace('Firebase: ', '').replace(/\(auth\/.+\)\.?/, '').trim() || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Package className="h-4 w-4" strokeWidth={2.25} />
          </div>
          <div>
            <div className="text-base font-semibold leading-tight">PP Logistics</div>
            <div className="text-xs text-muted-foreground">Admin sign-in</div>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 card-soft p-6">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" autoFocus {...register('email')} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Customers don't sign in — they receive a tracking link.
        </p>
      </div>
    </div>
  );
}
