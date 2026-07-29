"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { NAV_ITEMS } from "@/components/layout/navigation";

interface SidebarProps {
  /** Drawer state; only used below the `lg` breakpoint. */
  open: boolean;
  onClose: () => void;
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-1 p-3" aria-label="เมนูหลัก">
      {NAV_ITEMS.map((item) => {
        const normalised = pathname.endsWith("/") ? pathname : `${pathname}/`;
        const active = normalised === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
            )}
          >
            <Icon
              className={cn(
                "size-4.5 shrink-0 transition-colors",
                active
                  ? "text-brand-600 dark:text-brand-400"
                  : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300",
              )}
              aria-hidden="true"
            />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-5">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm"
        aria-hidden="true"
      >
        <Eye className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          MyEye
        </p>
        <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
          ระบบประเมินความเสี่ยง
        </p>
      </div>
    </div>
  );
}

function ResearchNotice() {
  return (
    <div className="m-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
        เครื่องมือวิจัย ไม่ใช่การวินิจฉัยทางการแพทย์
      </p>
    </div>
  );
}

/**
 * Persistent rail on desktop, slide-in drawer below `lg`.
 *
 * Both variants render the same `NavLinks`, so a navigation change is made in
 * exactly one place.
 */
export function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col dark:border-slate-800 dark:bg-slate-900">
        <Brand />
        <NavLinks />
        <ResearchNotice />
      </aside>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={onClose}
              className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden"
              aria-hidden="true"
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="เมนูหลัก"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 bg-white lg:hidden dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between pr-2">
                <Brand />
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="ปิดเมนู"
                  className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              <NavLinks onNavigate={onClose} />
              <ResearchNotice />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
