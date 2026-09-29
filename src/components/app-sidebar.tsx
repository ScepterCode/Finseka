import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  HeartHandshake,
  HandCoins,
  BookOpen,
  FileBarChart,
  ChartColumn,
  History,
  Settings,
  Wallet,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Members", url: "/members", icon: Users },
  { title: "Dues", url: "/dues", icon: CalendarCheck },
  { title: "Contributions", url: "/contributions", icon: HeartHandshake },
  { title: "Pledges & gifts", url: "/pledges", icon: HandCoins },
  { title: "Ledger", url: "/ledger", icon: BookOpen },
  { title: "Reports", url: "/reports", icon: FileBarChart },
  { title: "Analytics", url: "/analytics", icon: ChartColumn },
  { title: "History", url: "/history", icon: History },
  { title: "Settings & Admin", url: "/settings", icon: Settings },
] as const;

export function AppSidebar({ orgName }: { orgName: string }) {
  const { state, setOpen, setOpenMobile, isMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  function closeAfterNav() {
    if (isMobile) setOpenMobile(false);
    else setOpen(false);
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-1 py-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-wine-gradient text-primary-foreground shadow-soft">
            <Wallet className="size-4" aria-hidden />
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block font-display text-base font-semibold leading-tight">
                FinSeka
              </span>
              <span className="block truncate text-xs text-muted-foreground">{orgName}</span>
            </span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(item.url)}
                    tooltip={item.title}
                  >
                    <Link to={item.url} className="flex items-center gap-2" onClick={closeAfterNav}>
                      <item.icon className="size-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
