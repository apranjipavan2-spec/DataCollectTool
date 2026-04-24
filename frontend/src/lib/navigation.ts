export interface NavItem {
  label: string
  path: string
  icon: string
}

const ALL_ITEMS: Record<string, NavItem> = {
  dashboard:   { label: 'Dashboard',    path: '/',             icon: '📊' },
  forms:       { label: 'Forms',        path: '/builder',      icon: '📋' },
  collect:     { label: 'Collect',      path: '/collect',      icon: '📝' },
  programs:    { label: 'Programs',     path: '/programs',     icon: '🗂️' },
  progress:    { label: 'Progress',     path: '/progress',     icon: '📈' },
  fgAnalyzer:  { label: 'FG Analyzer',  path: '/fg/analyzer',  icon: '🔬' },
  fgCleaner:   { label: 'FG Cleaner',   path: '/fg/cleaner',   icon: '🧹' },
  fgWriter:    { label: 'FG Writer',    path: '/fg/writer',    icon: '✍️' },
  settings:    { label: 'Settings',     path: '/admin/org',    icon: '⚙️' },
  migration:   { label: 'Import',       path: '/migration',    icon: '🔄' },
  admin:       { label: 'Admin',        path: '/admin',        icon: '🔧' },
  monitor:     { label: 'Monitor',      path: '/monitor',      icon: '🌐' },
}

export const getNavItems = (role: string): NavItem[] => {
  switch (role) {
    case 'master_admin':
      return [ALL_ITEMS.admin, ALL_ITEMS.monitor]
    case 'org_admin':
      return [ALL_ITEMS.dashboard, ALL_ITEMS.forms, ALL_ITEMS.collect, ALL_ITEMS.programs, ALL_ITEMS.progress, ALL_ITEMS.fgAnalyzer, ALL_ITEMS.fgCleaner, ALL_ITEMS.fgWriter, ALL_ITEMS.settings, ALL_ITEMS.migration]
    case 'supervisor':
      return [ALL_ITEMS.dashboard, ALL_ITEMS.collect, ALL_ITEMS.programs, ALL_ITEMS.progress, ALL_ITEMS.fgAnalyzer, ALL_ITEMS.fgCleaner, ALL_ITEMS.fgWriter, ALL_ITEMS.settings]
    case 'enumerator':
      return [ALL_ITEMS.dashboard, ALL_ITEMS.collect]
    default:
      return [ALL_ITEMS.collect]
  }
}
