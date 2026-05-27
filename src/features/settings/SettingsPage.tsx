import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { FullPageSpinner } from '../../components/Spinner';
import { useSettings } from './useSettings';
import { PaymentMethodsTab } from './PaymentMethodsTab';
import { BusinessInfoTab } from './BusinessInfoTab';
import { MessageTemplatesTab } from './MessageTemplatesTab';

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  if (isLoading || !settings) return <FullPageSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Payment methods, branding, and templates.</p>
      </div>
      <Tabs defaultValue="payment" className="w-full">
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-flex">
          <TabsTrigger value="payment">Payment</TabsTrigger>
          <TabsTrigger value="business">Business</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
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
      </Tabs>
    </div>
  );
}
