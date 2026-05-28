import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { FullPageSpinner } from '../../components/Spinner';
import { PageHeader } from '../../components/PageHeader';
import { useSettings } from './useSettings';
import { PaymentMethodsTab } from './PaymentMethodsTab';
import { BusinessInfoTab } from './BusinessInfoTab';
import { MessageTemplatesTab } from './MessageTemplatesTab';
import { ExpenseCategoriesTab } from './ExpenseCategoriesTab';

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  if (isLoading || !settings) return <FullPageSpinner />;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Payment methods, branding, templates, and expense categories." />
      <Tabs defaultValue="payment" className="w-full">
        <TabsList className="grid w-full grid-cols-4 sm:w-auto sm:inline-flex">
          <TabsTrigger value="payment">Payment</TabsTrigger>
          <TabsTrigger value="business">Business</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="expenseCategories">Expense categories</TabsTrigger>
        </TabsList>
        <TabsContent value="payment">
          <PaymentMethodsTab methods={settings.payment.methods} />
        </TabsContent>
        <TabsContent value="business">
          <BusinessInfoTab business={settings.business} />
        </TabsContent>
        <TabsContent value="templates">
          <MessageTemplatesTab templates={settings.templates} />
        </TabsContent>
        <TabsContent value="expenseCategories">
          <ExpenseCategoriesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
