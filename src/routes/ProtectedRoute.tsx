import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { FullPageSpinner } from '../components/Spinner';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">Not authorised</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account is signed in but doesn't have admin access. Ask the owner to run{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run set-admin -- {user.email}</code>{' '}
          to grant access.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
