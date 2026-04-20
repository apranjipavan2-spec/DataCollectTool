export interface NavItem {
  label: string
  path: string
  icon: string
}

const ALL_ITEMS: Record<string, NavItem> = {
  dashboard: { label: 'Dashboard', path: '/',          icon: '📊' },
  forms:     { label: 'Forms',     path: '/builder',   icon: '📋' },
  collect:   { label: 'Collect',   path: '/collect',   icon: '📝' },
  settings:  { label: 'Settings',  path: '/admin/org', icon: '⚙️' },
  admin:     { label: 'Admin',     path: '/admin',     icon: '🔧' },
}

export const getNavItems = (role: string): NavItem[] => {
  switch (role) {
    case 'master_admin':
      return [ALL_ITEMS.admin]
    case 'org_admin':
      return [ALL_ITEMS.dashboard, ALL_ITEMS.forms, ALL_ITEMS.collect, ALL_ITEMS.settings]
    case 'supervisor':
      return [ALL_ITEMS.dashboard, ALL_ITEMS.collect, ALL_ITEMS.settings]
    case 'enumerator':
      return [ALL_ITEMS.dashboard, ALL_ITEMS.collect]
    default:
      return [ALL_ITEMS.collect]
  }
}
