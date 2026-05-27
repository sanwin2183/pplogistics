import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { LoginPage } from './routes/Login';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { OrdersListPage } from './features/orders/OrdersListPage';
import { OrderDetailPage } from './features/orders/OrderDetailPage';
import { OrderFormPage } from './features/orders/OrderFormPage';
import { FlyersListPage } from './features/flyers/FlyersListPage';
import { FlyerDetailPage } from './features/flyers/FlyerDetailPage';
import { CustomersListPage } from './features/customers/CustomersListPage';
import { CustomerDetailPage } from './features/customers/CustomerDetailPage';
import { CategoriesPage } from './features/categories/CategoriesPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { TrackingPage } from './features/tracking/TrackingPage';

export default function App() {
  return (
    <Routes>
      {/* Public tracking — no auth */}
      <Route path="/t/:slug" element={<TrackingPage />} />

      {/* Auth */}
      <Route path="/login" element={<LoginPage />} />

      {/* Admin */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="orders" element={<OrdersListPage />} />
        <Route path="orders/new" element={<OrderFormPage />} />
        <Route path="orders/:id" element={<OrderDetailPage />} />
        <Route path="orders/:id/edit" element={<OrderFormPage />} />
        <Route path="flyers" element={<FlyersListPage />} />
        <Route path="flyers/:id" element={<FlyerDetailPage />} />
        <Route path="customers" element={<CustomersListPage />} />
        <Route path="customers/:id" element={<CustomerDetailPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
