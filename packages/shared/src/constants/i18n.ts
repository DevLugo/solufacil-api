/**
 * Month names in English
 */
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
] as const

/**
 * Day names in English (starting from Sunday)
 */
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * Role labels for display
 */
export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  NORMAL: 'Route',
  CAPTURA: 'Data Entry',
  DOCUMENT_REVIEWER: 'Document Reviewer',
} as const

/**
 * Role colors for badges (Tailwind classes)
 */
export const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  NORMAL: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  CAPTURA: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  DOCUMENT_REVIEWER: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
} as const

/**
 * Employee type labels for display
 */
export const EMPLOYEE_TYPE_LABELS: Record<string, string> = {
  ROUTE_LEAD: 'Route Leader',
  LEAD: 'Salesperson',
  ROUTE_ASSISTENT: 'Assistant',
} as const

/**
 * Notification status labels
 */
export const NOTIFICATION_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  SENT: 'Sent',
  FAILED: 'Failed',
  RETRY: 'Retry',
} as const

/**
 * Notification status colors (Tailwind classes)
 */
export const NOTIFICATION_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  SENT: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  RETRY: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
} as const

/**
 * Report type labels
 */
export const REPORT_TYPE_LABELS: Record<string, string> = {
  NOTIFICACION_TIEMPO_REAL: 'Real-time Notification',
  CREDITOS_CON_ERRORES: 'Credits with Errors (PDF)',
} as const

/**
 * Issue type labels
 */
export const ISSUE_TYPE_LABELS: Record<string, string> = {
  ERROR: 'Error',
  MISSING: 'Missing',
} as const

/**
 * Dead debt status labels
 */
export const DEAD_DEBT_STATUS_LABELS: Record<string, string> = {
  UNMARKED: 'Unmarked',
  MARKED: 'Marked',
  ALL: 'All',
} as const
