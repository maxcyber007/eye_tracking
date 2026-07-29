import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { ToastProvider } from "@/components/ui/Toast";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: {
    default: "ระบบประเมินความเสี่ยงจากการเคลื่อนไหวดวงตา",
    template: "%s · Eye-Tracking",
  },
  description:
    "ต้นแบบงานวิจัยสำหรับประเมินความเสี่ยงโรคอัลไซเมอร์เบื้องต้นจากการเคลื่อนไหวดวงตา",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9fafb" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

/**
 * Applies the stored theme before first paint.
 *
 * Without this the page renders light and then flips to dark on hydration,
 * which is visible and unpleasant on every load.
 */
const THEME_BOOTSTRAP = `
try {
  var stored = localStorage.getItem('eyetrack-theme');
  var dark = stored ? stored === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" suppressHydrationWarning>
      {/*
        No webfont CDN on purpose. This tool handles participant health data
        and may run inside a hospital network or offline, where a request to a
        third-party font host would leak visitor IPs and would simply fail.
        The stack in globals.css uses the Thai system fonts already present on
        Windows, macOS, iOS and Android instead.
      */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
