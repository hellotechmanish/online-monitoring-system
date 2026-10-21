import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { getSettingsSafe } from "@/lib/safe-settings";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getSettingsSafe();
  return {
    title: { default: settings.projectTitle, template: `%s · ${settings.projectTitle}` },
    description: settings.projectSubtitle,
    icons: settings.faviconUrl ? [{ url: settings.faviconUrl }] : undefined,
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Applies "system" theme before paint (no user data involved).
const systemThemeScript = `try{if(window.matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { settings } = await getSettingsSafe();
  return (
    <html lang="en" className={settings.theme === "dark" ? "dark" : undefined} suppressHydrationWarning>
      <head>{settings.theme === "system" && <script dangerouslySetInnerHTML={{ __html: systemThemeScript }} />}</head>
      <body>
        {children}
        <Toaster position="top-right" offset={76} richColors closeButton duration={4000} />
      </body>
    </html>
  );
}
