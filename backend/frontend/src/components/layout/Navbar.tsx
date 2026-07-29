"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  ChevronRight,
  ExternalLink,
  LogOut,
  Menu,
  Moon,
  Search,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Dropdown } from "@/components/ui/Dropdown";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { findNavItem } from "@/components/layout/navigation";

interface NavbarProps {
  onOpenSidebar: () => void;
  /** Count shown on the notification bell; 0 hides the dot. */
  notificationCount?: number;
  onOpenNotifications?: () => void;
}

/** Top bar: menu toggle, breadcrumb, search, theme, notifications, account. */
export function Navbar({
  onOpenSidebar,
  notificationCount = 0,
  onOpenNotifications,
}: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const current = findNavItem(pathname);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-900/85">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="เปิดเมนู"
          className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>

        <nav aria-label="เส้นทาง" className="min-w-0 flex-1">
          <ol className="flex items-center gap-1.5 text-sm">
            <li className="hidden sm:block">
              <Link
                href="/dashboard/"
                className="rounded text-slate-500 transition-colors hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              >
                แดชบอร์ด
              </Link>
            </li>
            {current && (
              <>
                <li className="hidden sm:block" aria-hidden="true">
                  <ChevronRight className="size-3.5 text-slate-300 dark:text-slate-600" />
                </li>
                <li>
                  <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
                    {current.label}
                  </span>
                </li>
              </>
            )}
          </ol>
        </nav>

        <label className="relative hidden md:block">
          <span className="sr-only">ค้นหารหัสผู้เข้าร่วม</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="ค้นหารหัสผู้เข้าร่วม…"
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              const value = (event.target as HTMLInputElement).value.trim();
              router.push(
                value
                  ? `/dashboard/history/?subject=${encodeURIComponent(value)}`
                  : "/dashboard/history/",
              );
            }}
            className={cn(
              "h-9 w-56 rounded-lg border border-slate-300 bg-slate-50 pl-9 pr-3 text-sm",
              "placeholder:text-slate-400 transition-colors focus:border-brand-500 focus:bg-white",
              "dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-900",
            )}
          />
        </label>

        <button
          type="button"
          onClick={toggle}
          aria-label={theme === "dark" ? "สลับเป็นธีมสว่าง" : "สลับเป็นธีมมืด"}
          className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          {theme === "dark" ? (
            <Sun className="size-5" aria-hidden="true" />
          ) : (
            <Moon className="size-5" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={onOpenNotifications}
          aria-label={
            notificationCount > 0
              ? `การแจ้งเตือน ${notificationCount} รายการ`
              : "การแจ้งเตือน"
          }
          className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <Bell className="size-5" aria-hidden="true" />
          {notificationCount > 0 && (
            <span
              className="absolute right-1.5 top-1.5 size-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900"
              aria-hidden="true"
            />
          )}
        </button>

        <Dropdown
          label="เมนูผู้ใช้"
          trigger={
            <span className="flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
              <Avatar name={user?.display_name || "ผู้ใช้"} size="sm" />
              <span className="hidden text-left sm:block">
                <span className="block text-xs font-medium leading-tight text-slate-900 dark:text-slate-100">
                  {user?.display_name || "ไม่ทราบชื่อ"}
                </span>
                <span className="block text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                  {user?.role || "—"}
                </span>
              </span>
            </span>
          }
          items={[
            {
              label: "เปิดหน้าประเมิน",
              icon: <ExternalLink className="size-4" aria-hidden="true" />,
              onSelect: () => window.open("/ui/", "_blank", "noopener"),
            },
            {
              label: "ออกจากระบบ",
              icon: <LogOut className="size-4" aria-hidden="true" />,
              tone: "danger",
              onSelect: () => {
                void signOut().then(() => router.replace("/login/"));
              },
            },
          ]}
        />
      </div>

      {current && (
        <div className="border-t border-slate-100 px-4 py-2 sm:px-6 dark:border-slate-800/60">
          <div className="flex items-center gap-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {current.description}
            </p>
            <Badge tone="warning" className="ml-auto shrink-0 text-[10px]">
              ไม่ใช่เครื่องมือแพทย์
            </Badge>
          </div>
        </div>
      )}
    </header>
  );
}
