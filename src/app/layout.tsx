import type { Metadata } from "next";
import {
  Inter,
  JetBrains_Mono,
  Barlow_Condensed,
  Space_Mono,
} from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/context/AppContext";
import ThemeHandler from "@/components/ThemeHandler";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-barlow-condensed",
});
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  title: "OneWork - Unified Workspace",
  description:
    "The next-generation unified workspace for developers and teams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${barlowCondensed.variable} ${spaceMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Theme class: keep in sync with ThemeHandler via src/lib/theme.ts */}
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_BOOTSTRAP_SCRIPT,
          }}
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="bg-background-dark antialiased theme-transition"
        suppressHydrationWarning
      >
        <AppProvider>
          <ThemeHandler />
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
