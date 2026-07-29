import type { Metadata, Viewport } from "next";
import { Prompt } from "next/font/google";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { ToastProvider } from "@/components/ui/Toast";
import "@/styles/globals.css";

/**
 * Prompt, self-hosted.
 *
 * `next/font/google` downloads the files at build time and serves them from
 * the app's own origin, so the browser never contacts Google. That keeps the
 * requested typography while avoiding a third-party request from a page that
 * handles participant health data, and it still works offline.
 */
const prompt = Prompt({
  subsets: ["latin", "thai"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-prompt",
});

export const metadata: Metadata = {
  title: {
    default: "ระบบประเมินความเสี่ยงจากการเคลื่อนไหวดวงตา",
    template: "%s · MyEye",
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
    <html lang="th" className={prompt.variable} suppressHydrationWarning>
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
