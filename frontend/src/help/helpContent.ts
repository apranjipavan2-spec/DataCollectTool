// All help topics organized by section.
// Each topic has: id, title, description, steps[], elementId (for spotlight),
// and roles[] (which roles see this topic).

export interface HelpStep {
  icon: string
  text: string
}

export interface HelpTopic {
  id: string
  title: string
  description: string
  steps: HelpStep[]
  elementId?: string        // data-help-id value to spotlight
  roles?: string[]          // if set, only shown for these roles
  page?: string             // '/', '/builder', '/collect', '/admin/org', '*'
}

export interface HelpSection {
  id: string
  title: string
  icon: string
  topics: HelpTopic[]
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: '📊',
    topics: [
      {
        id: 'submission-status',
        title: 'Understanding Submission Statuses',
        description: 'Every submission has a status that tracks its review lifecycle.',
        steps: [
          { icon: '🔵', text: 'Synced — data arrived from the enumerator\'s device, awaiting review.' },
          { icon: '🟡', text: 'Flagged — supervisor marked it for follow-up or re-check.' },
          { icon: '🟢', text: 'Approved — supervisor confirmed the data is valid.' },
          { icon: '🔴', text: 'Rejected — data failed quality check; enumerator may need to resubmit.' },
        ],
        elementId: 'submissions-table',
        page: '/',
      },
      {
        id: 'filter-submissions',
        title: 'Filtering & Searching Submissions',
        description: 'Quickly narrow down thousands of records using the filter bar.',
        steps: [
          { icon: '📋', text: 'Select a form from the dropdown to see only submissions for that form.' },
          { icon: '📅', text: 'Use date range pickers to filter by collection date.' },
          { icon: '👤', text: 'Filter by enumerator to review a specific field worker\'s data.' },
          { icon: '🔍', text: 'The search box searches across enumerator names, phone numbers, and all field values.' },
        ],
        elementId: 'filter-bar',
        page: '/',
      },
      {
        id: 'flag-approve',
        title: 'Flagging, Approving & Rejecting',
        description: 'Open any submission to review its data and take action.',
        steps: [
          { icon: '👁️', text: 'Click any row in the submissions table to open the detail view.' },
          { icon: '🚩', text: 'Click "Flag for Review" to mark it — optionally add a note explaining why.' },
          { icon: '✅', text: 'Click "Approve" once the data looks correct.' },
          { icon: '❌', text: 'Click "Reject" and provide a reason — this is recorded in the audit log.' },
        ],
        elementId: 'submission-detail',
        page: '/',
      },
      {
        id: 'export-data',
        title: 'Exporting Data',
        description: 'Download your collected data as CSV or Stata .dta file.',
        steps: [
          { icon: '📤', text: 'Click "Export CSV" or "Export Stata" in the Dashboard toolbar.' },
          { icon: '📋', text: 'Select the form you want to export.' },
          { icon: '📅', text: 'Optionally filter by date range and status before exporting.' },
          { icon: '💾', text: 'The file downloads immediately — open in Excel, SPSS, or Stata.' },
        ],
        elementId: 'export-btn',
        page: '/',
        roles: ['org_admin', 'supervisor'],
      },
      {
        id: 'map-view',
        title: 'GPS Map View',
        description: 'See exactly where each submission was collected on a map.',
        steps: [
          { icon: '🗺️', text: 'Open any submission by clicking its row.' },
          { icon: '📍', text: 'If the enumerator had GPS enabled, a map appears showing open & submit locations.' },
          { icon: '📏', text: 'Two pins are shown: where the form was opened vs. where it was submitted.' },
          { icon: '🎯', text: 'Accuracy radius is shown — smaller circle means more precise GPS.' },
        ],
        elementId: 'submission-map',
        page: '/',
      },
    ],
  },
  {
    id: 'form-builder',
    title: 'Form Builder',
    icon: '🏗️',
    topics: [
      {
        id: 'create-form',
        title: 'Creating a New Form',
        description: 'Build a data collection form from scratch using the drag-and-drop builder.',
        steps: [
          { icon: '➕', text: 'Click "New Form" in the Forms tab of the Dashboard.' },
          { icon: '✏️', text: 'Give your form a title — this is what enumerators see on their device.' },
          { icon: '📂', text: 'Add sections to organise fields into logical groups (e.g. Household Info, Health).' },
          { icon: '🏷️', text: 'Click "+ Add Field" inside a section to add your first question.' },
          { icon: '💾', text: 'Click "Save & Publish" to make the form available to enumerators.' },
        ],
        elementId: 'new-form-btn',
        page: '/builder',
        roles: ['org_admin'],
      },
      {
        id: 'field-types',
        title: 'Field Types Explained',
        description: '15 field types cover every data collection need.',
        steps: [
          { icon: '𝐓', text: 'Text / Textarea — free text answers, names, addresses, notes.' },
          { icon: '#', text: 'Number / Decimal — quantities, ages, measurements, amounts.' },
          { icon: '◉', text: 'Single Choice / Multiple Choice — select from a pre-defined list.' },
          { icon: '📅', text: 'Date / Time — calendar or time picker.' },
          { icon: '📍', text: 'GPS — captures latitude, longitude, and accuracy automatically.' },
          { icon: '📷', text: 'Photo — captures or uploads an image, auto-compressed to ~200KB.' },
          { icon: '🎙️', text: 'Audio — records up to 30s voice note at ~100KB.' },
          { icon: '▦', text: 'Barcode / QR — scan product codes or asset tags.' },
        ],
        elementId: 'field-type-menu',
        page: '/builder',
        roles: ['org_admin'],
      },
      {
        id: 'skip-logic',
        title: 'Skip Logic (Conditional Fields)',
        description: 'Show or hide fields based on previous answers.',
        steps: [
          { icon: '🔧', text: 'Click the "Skip Logic" button on any field in the Form Builder.' },
          { icon: '📋', text: 'Choose a source field (the question whose answer controls visibility).' },
          { icon: '⚙️', text: 'Set the condition: equals, contains, greater than, etc.' },
          { icon: '👁️', text: 'Set the action: "Show this field only when…" or "Hide this field when…".' },
          { icon: '🔗', text: 'Chain multiple conditions using AND / OR logic.' },
        ],
        elementId: 'skip-logic-btn',
        page: '/builder',
        roles: ['org_admin'],
      },
      {
        id: 'import-excel',
        title: 'Importing Form from Excel',
        description: 'Convert an existing Excel data sheet into a FieldGovern form automatically.',
        steps: [
          { icon: '📂', text: 'Click "Import from Excel" in the Form Builder toolbar.' },
          { icon: '📊', text: 'Upload your .xlsx file — the first rows are treated as headers.' },
          { icon: '🔀', text: 'Merged cells work: the merged header becomes the section name, cells below become fields.' },
          { icon: '🎯', text: 'Field types are auto-detected: ≤8 unique values → Select, numbers → Number, dates → Date.' },
          { icon: '✏️', text: 'Review and adjust the detected schema, then click "Create Form".' },
        ],
        elementId: 'import-excel-btn',
        page: '/builder',
        roles: ['org_admin'],
      },
      {
        id: 'form-versions',
        title: 'Form Versioning & Migration',
        description: 'Safely update a live form without breaking existing submissions.',
        steps: [
          { icon: '📌', text: 'Every time you save changes to a published form, a new version is created automatically.' },
          { icon: '🕰️', text: 'Click "Version History" to see all past schemas.' },
          { icon: '🔄', text: 'Use "Migrate Submissions" to update old responses to the new schema (e.g. renamed fields).' },
          { icon: '⚠️', text: 'Never delete a field that has existing data — rename it instead so migration can match it.' },
        ],
        elementId: 'version-history-btn',
        page: '/builder',
        roles: ['org_admin'],
      },
    ],
  },
  {
    id: 'data-collection',
    title: 'Data Collection (Field App)',
    icon: '📱',
    topics: [
      {
        id: 'offline-mode',
        title: 'How Offline Mode Works',
        description: 'FieldGovern saves data locally on the device — no internet required to collect.',
        steps: [
          { icon: '💾', text: 'Every field answer is auto-saved to the browser\'s local storage every 300ms.' },
          { icon: '📵', text: 'Turn off WiFi/data — the app continues to work completely normally.' },
          { icon: '🗄️', text: 'On Chrome/Edge: data is stored in OPFS (Origin Private File System) — no size limit.' },
          { icon: '📱', text: 'On Safari/Firefox: IndexedDB with Dexie — up to ~1GB on most devices.' },
          { icon: '🔒', text: 'Data is stored securely on the device and only leaves when you sync.' },
        ],
        elementId: 'offline-indicator',
        page: '/collect',
      },
      {
        id: 'sync',
        title: 'Syncing Data to the Server',
        description: 'Data uploads automatically when internet is restored.',
        steps: [
          { icon: '🌐', text: 'When the device comes back online, sync starts automatically in the background.' },
          { icon: '📝', text: 'Phase 1: Text data is sent first (fast, even on 2G).' },
          { icon: '📸', text: 'Phase 2: Photos and audio are uploaded after text (compressed to <200KB each).' },
          { icon: '🔁', text: 'Failed uploads retry automatically — you can also tap the Sync button to force it.' },
          { icon: '✅', text: 'Sync is idempotent — submitting the same response twice never creates a duplicate.' },
        ],
        elementId: 'sync-btn',
        page: '/collect',
      },
      {
        id: 'gps',
        title: 'GPS Coordinates',
        description: 'Location is captured at form open and at submit for verification.',
        steps: [
          { icon: '📍', text: 'GPS is captured automatically when you open a form (open location).' },
          { icon: '📌', text: 'GPS is captured again when you tap Submit (submit location).' },
          { icon: '🎯', text: 'For GPS fields in the form: tap the field to capture current location manually.' },
          { icon: '⏱️', text: 'Wait for accuracy < 15m before accepting — move to an open area for better signal.' },
        ],
        elementId: 'gps-field',
        page: '/collect',
      },
    ],
  },
  {
    id: 'bulk-upload',
    title: 'Bulk Upload',
    icon: '📤',
    topics: [
      {
        id: 'download-template',
        title: 'Downloading the Excel Template',
        description: 'Always start from the official template — it has the correct column structure.',
        steps: [
          { icon: '📋', text: 'Go to Dashboard → Forms tab → click the form you want to upload data for.' },
          { icon: '⬇️', text: 'Click "Download Template" — an .xlsx file tailored to that form downloads.' },
          { icon: '🎨', text: 'Row 1: section headers (color-coded). Row 2: field labels (* = required).' },
          { icon: '💡', text: 'Row 3: type hints and allowed values for dropdowns. Row 4: example data (delete before uploading).' },
          { icon: '📖', text: 'See the "Instructions" sheet in the file for detailed guidance.' },
        ],
        elementId: 'download-template-btn',
        page: '/',
        roles: ['org_admin', 'master_admin'],
      },
      {
        id: 'metadata-columns',
        title: 'Metadata Columns (Location & Time)',
        description: 'Tell the system when and where data was actually collected.',
        steps: [
          { icon: '📍', text: '_Latitude / _Longitude — decimal degrees (e.g. 12.9716, 77.5946). Stored as GPS coordinates.' },
          { icon: '🕐', text: '_Collected At — the actual date/time of data collection. Format: YYYY-MM-DD HH:MM.' },
          { icon: '👤', text: '_Enumerator Phone — phone number or name of the field worker who collected this row.' },
          { icon: '⚠️', text: 'If _Collected At is blank, the upload timestamp is used instead.' },
          { icon: '✅', text: '_Enumerator Phone must match a user in your org. If not found, the uploader is used.' },
        ],
        elementId: 'metadata-help',
        page: '/',
        roles: ['org_admin', 'master_admin'],
      },
      {
        id: 'column-mapping',
        title: 'Column Mapping',
        description: 'Map your Excel columns to form fields before uploading.',
        steps: [
          { icon: '📂', text: 'Go to Dashboard → Forms tab → "Bulk Upload" → select your form.' },
          { icon: '⬆️', text: 'Upload your filled Excel/CSV file.' },
          { icon: '🔀', text: 'The system shows your file\'s columns and suggests a matching to form fields.' },
          { icon: '✏️', text: 'Review and adjust: use the dropdowns to correct any mis-matched columns.' },
          { icon: '🚀', text: 'Click "Upload" — results show how many rows were created, skipped, or had errors.' },
        ],
        elementId: 'bulk-upload-btn',
        page: '/',
        roles: ['org_admin', 'master_admin'],
      },
    ],
  },
  {
    id: 'team',
    title: 'Team & Assignments',
    icon: '👥',
    topics: [
      {
        id: 'add-user',
        title: 'Adding Team Members',
        description: 'Invite enumerators, supervisors, and admins to your organisation.',
        steps: [
          { icon: '➕', text: 'Go to Dashboard → Team tab → click "Add User".' },
          { icon: '📱', text: 'Enter their name and mobile number (used as login ID).' },
          { icon: '🎭', text: 'Assign a role: Enumerator (collects data), Supervisor (reviews data), Org Admin (full access).' },
          { icon: '🔑', text: 'The default password is set — share it securely and ask them to change it after first login.' },
        ],
        elementId: 'add-user-btn',
        page: '/',
        roles: ['org_admin'],
      },
      {
        id: 'assign-forms',
        title: 'Assigning Forms to Enumerators',
        description: 'Enumerators only see forms explicitly assigned to them.',
        steps: [
          { icon: '📋', text: 'Go to Dashboard → Forms tab → select a form.' },
          { icon: '👤', text: 'Click "Assign" and choose the enumerator(s) who should collect data for this form.' },
          { icon: '📱', text: 'The form appears immediately on the enumerator\'s device (no app restart needed).' },
          { icon: '🔒', text: 'Supervisors and admins always see all forms regardless of assignment.' },
        ],
        elementId: 'assign-form-btn',
        page: '/',
        roles: ['org_admin', 'supervisor'],
      },
      {
        id: 'roles',
        title: 'Roles & Permissions',
        description: 'Each role has specific capabilities in the system.',
        steps: [
          { icon: '👑', text: 'Master Admin — platform-level: creates/manages tenants, full access across all orgs.' },
          { icon: '🏢', text: 'Org Admin — creates forms, manages users, does bulk uploads, exports, assigns forms.' },
          { icon: '👁️', text: 'Supervisor — reviews submissions, flags/approves/rejects, views all team data.' },
          { icon: '📱', text: 'Enumerator — collects data using the Field App, sees only assigned forms.' },
        ],
        elementId: 'roles-info',
        page: '/',
      },
    ],
  },
]

export function getTopicById(id: string): HelpTopic | undefined {
  for (const section of HELP_SECTIONS) {
    const topic = section.topics.find(t => t.id === id)
    if (topic) return topic
  }
  return undefined
}

export function getSectionsForRole(role: string): HelpSection[] {
  return HELP_SECTIONS.map(section => ({
    ...section,
    topics: section.topics.filter(t => !t.roles || t.roles.includes(role)),
  })).filter(s => s.topics.length > 0)
}
