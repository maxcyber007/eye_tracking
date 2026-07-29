import {
  ClipboardList,
  LayoutDashboard,
  Video,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

/** Single source of truth for the sidebar links and the breadcrumb labels. */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard/",
    label: "ภาพรวม",
    icon: LayoutDashboard,
    description: "สถานะชุดข้อมูล โมเดล และระบบ",
  },
  {
    href: "/dashboard/history/",
    label: "รายงานประวัติ",
    icon: ClipboardList,
    description: "ผลประเมินทั้งหมดของผู้เข้าร่วม",
  },
  {
    href: "/dashboard/collect/",
    label: "เก็บข้อมูล",
    icon: Video,
    description: "บันทึกตัวอย่างพร้อม label",
  },
];

/** Resolve a pathname to its navigation entry, for breadcrumbs and titles. */
export function findNavItem(pathname: string): NavItem | undefined {
  const normalised = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return NAV_ITEMS.find((item) => item.href === normalised);
}
