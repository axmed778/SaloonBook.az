import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SalonBook.az — onlayn qeydiyyat",
  description: "Müştərilərinizin özləri 24/7 qeydiyyatdan keçməsinə imkan verin.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="az">
      <body>{children}</body>
    </html>
  );
}
