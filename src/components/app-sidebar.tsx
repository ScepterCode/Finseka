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
  ShieldAlert,
  MessageCircle,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { BrandMark } from "@/components/brand-mark";
import { supportLink } from "@/lib/support";

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

export function AppSidebar({
  orgName,
  showSystemAdmin,
}: {
  orgName: string;
  showSystemAdmin: boolean;
}) {
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
          <BrandMark />
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
        {showSystemAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>FinSeka staff</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith("/admin")}
                    tooltip="System admin"
                  >
                    <Link to="/admin" className="flex items-center gap-2" onClick={closeAfterNav}>
                      <ShieldAlert className="size-4" />
                      {!collapsed && <span>System admin</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Help on WhatsApp">
              <a
                href={supportLink(`Hello FinSeka, I need help with ${orgName}.`)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                <MessageCircle className="size-4" />
                {!collapsed && <span>Help on WhatsApp</span>}
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
