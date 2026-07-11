export type AdminPermission =
  | "content:read"
  | "content:write"
  | "economy:read"
  | "economy:adjust"
  | "players:read"
  | "players:moderate"
  | "support:write"
  | "analytics:read"
  | "audit:read"
  | "admins:manage";

export type AdminNavigationItem = Readonly<{
  href: string;
  label: string;
  permission: AdminPermission;
}>;

const ADMIN_NAVIGATION: readonly AdminNavigationItem[] = [
  { href: "/content", label: "Content", permission: "content:read" },
  { href: "/economy", label: "Economy", permission: "economy:read" },
  { href: "/players", label: "Players", permission: "players:read" },
  { href: "/support", label: "Support", permission: "support:write" },
  { href: "/analytics", label: "Analytics", permission: "analytics:read" },
  { href: "/audit", label: "Audit", permission: "audit:read" },
  { href: "/administrators", label: "Administrators", permission: "admins:manage" },
];

export function navigationForPermissions(permissions: readonly AdminPermission[]): readonly AdminNavigationItem[] {
  const granted = new Set(permissions);
  return ADMIN_NAVIGATION.filter((item) => granted.has(item.permission));
}
