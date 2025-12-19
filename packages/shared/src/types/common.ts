/**
 * Generic API Response type
 */
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    message: string
    code?: string
    details?: unknown
  }
}

/**
 * Pagination params
 */
export interface PaginationParams {
  limit?: number
  offset?: number
}

/**
 * Cursor-based pagination
 */
export interface CursorPaginationParams {
  first?: number
  after?: string
  last?: number
  before?: string
}

/**
 * Date range filter
 */
export interface DateRangeFilter {
  fromDate?: Date
  toDate?: Date
}
