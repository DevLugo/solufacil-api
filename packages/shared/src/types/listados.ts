/**
 * Tipos compartidos para la funcionalidad de listados de cobranza
 */

/**
 * Modo de semana para generación de listados
 */
export type WeekMode = 'current' | 'next'

export const WEEK_MODES = {
  CURRENT: 'current' as WeekMode,
  NEXT: 'next' as WeekMode
} as const

/**
 * Parámetros para generar un PDF de listado de cobranza
 * Compartido entre frontend y backend para garantizar type safety
 */
export interface ListadoParams {
  localityId: string
  routeId: string
  localityName: string
  routeName: string
  leaderName: string
  leaderId: string
  weekMode: WeekMode
}
