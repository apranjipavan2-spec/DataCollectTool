export interface NavItem {
  label: string
  path: string
  icon: string
}

const ALL_ITEMS: Record<string, NavItem> = {
  dashboard:   { label: 'Dashboard',    path: '/',             icon: '📊' },
  forms:       { label: 'Form Builder',  path: '/builder',      icon: '📋' },
  collect:     { label: 'Collect Data', path: '/collect',      icon: '📝' },
  programs:    { label: 'Programs',     path: '/programs',     icon: '🗂️' },
  progress:    { label: 'Progress',     path: '/progress',     icon: '📈' },
  fgAnalyzer:  { label: 'Analyzer',     path: '/fg/analyzer',  icon: '🔬' },
  fgCleaner:   { label: 'Cleaner',      path: '/fg/cleaner',   icon: '🧹' },
  fgWriter:    { label: 'Writer',       path: '/fg/writer',    icon: '✍️' },
  fileManager: { label: 'Files',        path: '/fg/files',     icon: '📁' },
  fieldMap:    { label: 'Field Map',    path: '/map',          icon: '🗺️' },
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
      return [ALL_ITEMS.dashboard, ALL_ITEMS.forms, ALL_ITEMS.collect, ALL_ITEMS.programs, ALL_ITEMS.progress, ALL_ITEMS.fgAnalyzer, ALL_ITEMS.fgCleaner, ALL_ITEMS.fgWriter, ALL_ITEMS.fileManager, ALL_ITEMS.fieldMap, ALL_ITEMS.settings]
    case 'supervisor':
      return [ALL_ITEMS.dashboard, ALL_ITEMS.collect, ALL_ITEMS.programs, ALL_ITEMS.progress, ALL_ITEMS.fgAnalyzer, ALL_ITEMS.fgCleaner, ALL_ITEMS.fgWriter, ALL_ITEMS.fileManager, ALL_ITEMS.fieldMap, ALL_ITEMS.settings]
    case 'enumerator':
      return [ALL_ITEMS.dashboard, ALL_ITEMS.collect]
    default:
      return [ALL_ITEMS.collect]
  }
}
