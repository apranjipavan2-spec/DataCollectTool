export interface NavItem {
  label: string
  path: string
  icon: string
}

export const getNavItems = (role: string): NavItem[] => {
  const items: NavItem[] = [
    { label: 'Dashboard', path: '/', icon: '📊' },
    { label: 'Forms', path: '/builder', icon: '📋' },
    { label: 'Collect', path: '/collect', icon: '📝' },
    { label: 'Settings', path: '/admin/org', icon: '⚙️' },
  ]
  if (role === 'master_admin') {
    items.push({ label: 'Admin', path: '/admin', icon: '🔧' })
  }
  return items
}
