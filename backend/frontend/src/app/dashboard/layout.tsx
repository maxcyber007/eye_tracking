"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Sidebar } from "@/components/layout/Sidebar";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageLoading } from "@/components/ui/Loading";
import { useRequireAuth } from "@/hooks/useAuth";

/**
 * Authenticated shell: sidebar, navbar, content area, footer.
 *
 * The auth guard lives here rather than in each page, so a new dashboard route
 * is protected by construction.
 */
export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, authEnabled, loading } = useRequireAuth();

  if (loading) return <PageLoading message="กำลังตรวจสอบสิทธิ์…" />;
  if (authEnabled && !user) return <PageLoading message="กำลังพาไปหน้าเข้าสู่ระบบ…" />;

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-slate-950">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar onOpenSidebar={() => setSidebarOpen(true)} />

        <motion.main
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="flex-1 px-4 py-6 sm:px-6 lg:px-8"
        >
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </motion.main>

        <Footer />
      </div>
    </div>
  );
}
