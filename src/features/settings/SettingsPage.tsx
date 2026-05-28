import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { FullPageSpinner } from '../../components/Spinner';
import { PageHeader } from '../../components/PageHeader';
import { useSettings } from './useSettings';
import { PaymentMethodsTab } from './PaymentMethodsTab';
import { BusinessInfoTab } from './BusinessInfoTab';
import { MessageTemplatesTab } from './MessageTemplatesTab';
import { ExpenseCategoriesTab } from './ExpenseCategoriesTab';
import { ExportTab } from './ExportTab';

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  if (isLoading || !settings) return <FullPageSpinner />;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Payment methods, branding, templates, expenses, and CSV export." />
      <Tabs defaultValue="payment" className="w-full">
        {/*
          Tab strip — horizontally scrollable on mobile, inline-flex on
          sm+ desktop. Each trigger has shrink-0 + snap-start so the
          browser snaps the leading edge of the next tab to the
          container's leading edge on a swipe / scroll. Scrollbar is
          visually hidden ([scrollbar-width:none] + WebKit ::-webkit-
          scrollbar:hidden) so the touch interaction feels clean.

          Replaces the old `grid w-full grid-cols-4` strip which gave
          each tab equal-width cells — once a label was as long as
          "Expense categories", four tabs of equal width broke the
          layout on a 414 px viewport and the labels overlapped.
          Scroll + snap scales gracefully to N tabs.
        */}
        <TabsList
          className="
            flex w-full overflow-x-auto snap-x snap-mandatory
            [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
            sm:w-auto sm:inline-flex sm:overflow-visible
          "
        >
          <TabsTrigger value="payment" className="shrink-0 snap-start">Payment</TabsTrigger>
          <TabsTrigger value="business" className="shrink-0 snap-start">Business</TabsTrigger>
          <TabsTrigger value="templates" className="shrink-0 snap-start">Templates</TabsTrigger>
          {/* Shortened from "Expense categories" — saves space on the
              strip and the page heading inside already names the
              section clearly ("Expense categories" is the H3 inside
              ExpenseCategoriesTab). */}
          <TabsTrigger value="expenseCategories" className="shrink-0 snap-start">Expenses</TabsTrigger>
          <TabsTrigger value="export" className="shrink-0 snap-start">Export</TabsTrigger>
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
        <TabsContent value="export">
          <ExportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
