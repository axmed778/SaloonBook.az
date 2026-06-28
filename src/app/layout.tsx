import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "SalonBook.az — onlayn qeydiyyat 24/7",
  description:
    "Müştərilərinizin özləri 24/7 onlayn qeydiyyatdan keçməsinə imkan verin. Salonunuz üçün şəxsi qeydiyyat linki yaradın və paylaşın.",
};

// Runs before paint: applies the saved theme (or the OS preference) so there's
// no flash of the wrong theme. Kept tiny and dependency-free.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';}var d=document.documentElement;d.classList.remove('light','dark');d.classList.add(t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="az"
      className={`${GeistSans.variable} ${GeistMono.variable} dark`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
