import { I18nProvider } from "@/lib/i18n/provider";
import { getI18n } from "@/lib/i18n/server";

// Keep request cookies below the root layout so marketing pages stay static.
export default async function LocalizedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale } = await getI18n();
  return (
    <I18nProvider locale={locale}>
      {children}
    </I18nProvider>
  );
}
