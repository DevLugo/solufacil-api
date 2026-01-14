/**
 * =============================================================================
 * PORTFOLIO REPORT TYPES
 * =============================================================================
 *
 * Types for the Portfolio Report (Reporte de Cartera) system.
 *
 * KEY CONCEPTS:
 * -------------
 * - Active Week: Monday 00:00 to Sunday 23:59
 * - CV (Cartera Vencida): Active loan that didn't receive payment in active week
 * - Active Client: Has pending debt, no badDebtDate, not excluded
 * - Client Al Corriente: Active client NOT in CV
 * - Client Balance: +1 new, -1 finished without renewal, 0 renewal
 *
 * =============================================================================
 */

/**
 * Rango de una semana activa
 */
export interface WeekRange {
  /** Inicio de semana (Lunes 00:00:00) */
  start: Date
  /** Fin de semana (Domingo 23:59:59) */
  end: Date
  /** Número de semana en el año (1-53) */
  weekNumber: number
  /** Año al que pertenece la semana */
  year: number
}

/**
 * Información del mes al que pertenece una semana
 */
export interface WeekMonthAssignment {
  /** Mes (0-11) */
  month: number
  /** Año */
  year: number
  /** Días de entre semana (L-V) en este mes */
  weekdaysInMonth: number
}

/**
 * Tipo de período para reportes
 */
export type PeriodType = 'WEEKLY' | 'MONTHLY'

/**
 * Tendencia de una métrica
 */
export type Trend = 'UP' | 'DOWN' | 'STABLE'

/**
 * Estado de CV de un préstamo
 */
export type CVStatus = 'AL_CORRIENTE' | 'EN_CV' | 'EXCLUIDO'

/**
 * Motivo de exclusión de un préstamo
 */
export type ExclusionReason = 'BAD_DEBT' | 'CLEANUP' | 'NOT_ACTIVE'

/**
 * Datos mínimos de un préstamo para cálculos de portfolio
 */
export interface LoanForPortfolio {
  id: string
  /** Monto pendiente (almacenado en DB) */
  pendingAmountStored: number
  /** Fecha de firma del préstamo */
  signDate: Date
  /** Fecha de finalización (null si activo) */
  finishedDate: Date | null
  /** Fecha de renovación (null si no renovó) */
  renewedDate: Date | null
  /** Fecha de mala deuda (null si no es bad debt) */
  badDebtDate: Date | null
  /** ID de exclusión por limpieza (null si no excluido) */
  excludedByCleanup: string | null
  /** Fecha de cleanup (para verificación por fecha) */
  cleanupDate?: Date | null
  /** ID del préstamo anterior (null si es primer préstamo) */
  previousLoan: string | null
  /**
   * Fecha en que el préstamo anterior terminó (finishedDate del previousLoan).
   * Se usa para distinguir renovación vs reintegro:
   * - Renovación: terminó en la MISMA semana que se firmó este préstamo
   * - Reintegro: terminó en una semana DIFERENTE
   */
  previousLoanFinishedDate?: Date | null
  /** Status del préstamo (usado como fallback para renovaciones) */
  status?: string
  /**
   * Indica si el préstamo fue renovado (calculado desde EXISTS en la query).
   * Más confiable que renewedDate porque no depende de datos migrados.
   */
  wasRenewed?: boolean
  /** Monto solicitado (para calcular deuda total) */
  requestedAmount?: number
  /**
   * Monto físicamente entregado al cliente.
   * Si amountGived < requestedAmount, significa que hubo deuda pendiente del
   * préstamo anterior que se descontó → es una renovación verdadera.
   */
  amountGived?: number
  /** Tasa de interés del loantype (para calcular deuda total) */
  rate?: number
  /** Total pagado hasta la fecha (para calcular monto pendiente real) */
  totalPaid?: number
  /** Duración del préstamo en semanas (para calcular pago semanal esperado) */
  weekDuration?: number
  /** Deuda total (amountGived + profitAmount) */
  totalDebt?: number
}

/**
 * Información de renovación de un préstamo
 */
export interface LoanRenewalInfo {
  /** ID del préstamo que renueva */
  id: string
  /** Fecha de firma del préstamo que renueva */
  signDate: Date
}

/**
 * Datos mínimos de un pago para cálculos de CV
 */
export interface PaymentForCV {
  id: string
  /** Fecha de recepción del pago */
  receivedAt: Date
  /** Monto del pago */
  amount: number
}

/**
 * Resultado del cálculo de CV para un préstamo
 */
export interface CVCalculationResult {
  /** ID del préstamo */
  loanId: string
  /** Estado de CV */
  status: CVStatus
  /** Razón de exclusión (si aplica) */
  exclusionReason?: ExclusionReason
  /** Número de pagos en la semana */
  paymentsInWeek: number
  /** Si salió de CV esta semana (hizo 2+ pagos después de estar en CV) */
  exitedCVThisWeek: boolean
}

/**
 * Resultado del balance de clientes
 */
export interface ClientBalanceResult {
  /** Clientes nuevos (primer préstamo) en el período */
  nuevos: number
  /** Clientes que terminaron sin renovar */
  terminadosSinRenovar: number
  /** Clientes que renovaron (préstamo anterior tenía deuda pendiente) */
  renovados: number
  /**
   * Reintegros: Clientes que regresan después de pagar completamente su préstamo anterior.
   * previousLoan !== null AND amountGived === requestedAmount
   * (No se descontó deuda del préstamo anterior)
   */
  reintegros: number
  /** Balance neto (nuevos + reintegros - terminadosSinRenovar) */
  balance: number
  /** Tendencia del balance */
  trend: Trend
}

/**
 * KPIs de renovación
 */
export interface RenovationKPIs {
  /** Total de renovaciones en el período */
  totalRenovaciones: number
  /** Total de cierres sin renovar */
  totalCierresSinRenovar: number
  /** Tasa de renovación (0-1) */
  tasaRenovacion: number
  /** Tendencia de la tasa */
  tendencia: Trend
}

/**
 * Comparación con período anterior
 */
export interface PeriodComparison {
  /** Datos del período anterior */
  previousPeriod: {
    clientesActivos: number
    clientesEnCV: number
    balance: number
  }
  /** Cambio en clientes en CV */
  cvChange: number
  /** Cambio en balance */
  balanceChange: number
}

/**
 * Resumen global del reporte
 */
export interface PortfolioSummary {
  /** Clientes activos al INICIO del período (solo para reportes mensuales) */
  clientesActivosInicio?: number
  /** Total de clientes activos (al final del período) */
  totalClientesActivos: number
  /** Clientes al corriente (activos y no en CV) */
  clientesAlCorriente: number
  /** Clientes en cartera vencida (de la última semana completada, o promedio mensual) */
  clientesEnCV: number
  /** Promedio de clientes en CV de las semanas completadas (solo para reportes mensuales) */
  promedioCV?: number
  /** Número de semanas completadas usadas para calcular el promedio */
  semanasCompletadas?: number
  /** Total de semanas en el período */
  totalSemanas?: number
  /** Balance de clientes */
  clientBalance: ClientBalanceResult
  /** Comparación con período anterior (null si no hay datos) */
  comparison: PeriodComparison | null
}

/**
 * Datos de una semana para reporte mensual
 */
export interface WeeklyPortfolioData {
  /** Rango de la semana */
  weekRange: WeekRange
  /** Clientes activos esa semana */
  clientesActivos: number
  /** Clientes al corriente (pagaron en la semana) */
  clientesAlCorriente: number
  /** Clientes en CV esa semana */
  clientesEnCV: number
  /** Balance de clientes esa semana */
  balance: number
  /** Si la semana ya está completada (pasó el domingo) */
  isCompleted: boolean
}

/**
 * Desglose por localidad/ruta
 */
export interface LocationBreakdown {
  /** ID de la localidad */
  locationId: string
  /** Nombre de la localidad */
  locationName: string
  /** ID de la ruta (opcional) */
  routeId?: string
  /** Nombre de la ruta (opcional) */
  routeName?: string
  /** Clientes activos en esta localidad (última semana completada) */
  clientesActivos: number
  /** Clientes al corriente (última semana completada) */
  clientesAlCorriente: number
  /** Clientes en CV (última semana completada) */
  clientesEnCV: number
  /** Balance de clientes */
  balance: number
  /** Promedio de clientes pagando en semanas completadas */
  pagandoPromedio?: number
  /** Promedio de CV en semanas completadas */
  cvPromedio?: number
}

/**
 * Filtros para el reporte de portfolio
 */
export interface PortfolioFilters {
  /** Filtrar por localidades */
  locationIds?: string[]
  /** Filtrar por rutas */
  routeIds?: string[]
  /** Filtrar por tipos de préstamo */
  loantypeIds?: string[]
}

/**
 * Reporte de Portfolio completo
 */
export interface PortfolioReport {
  /** Fecha de generación del reporte */
  reportDate: Date
  /** Tipo de período */
  periodType: PeriodType
  /** Año */
  year: number
  /** Mes (solo para reportes mensuales) */
  month?: number
  /** Número de semana (solo para reportes semanales) */
  weekNumber?: number
  /** Resumen global */
  summary: PortfolioSummary
  /** Datos semanales (para reportes mensuales) */
  weeklyData: WeeklyPortfolioData[]
  /** Desglose por localidad */
  byLocation: LocationBreakdown[]
  /** KPIs de renovación */
  renovationKPIs: RenovationKPIs
}

/**
 * Estado de un cliente activo con su estado CV
 */
export interface ActiveClientStatus {
  /** ID del préstamo */
  loanId: string
  /** ID del borrower */
  borrowerId: string
  /** Nombre del cliente */
  clientName: string
  /** Monto pendiente */
  pendingAmount: number
  /** Estado de CV */
  cvStatus: CVStatus
  /** Días desde último pago */
  daysSinceLastPayment: number | null
  /** Nombre de localidad */
  locationName: string
  /** Nombre de ruta */
  routeName: string
}

/**
 * Resultado de generación de PDF
 */
export interface PDFGenerationResult {
  /** Si la generación fue exitosa */
  success: boolean
  /** URL temporal para descarga (si aplica) */
  url?: string
  /** PDF en base64 (alternativa) */
  base64?: string
  /** Nombre del archivo */
  filename: string
  /** Fecha de generación */
  generatedAt: Date
  /** Mensaje de error (si falló) */
  error?: string
}

// =============================================================================
// LOCALITY REPORT TYPES (Vista por Localidad)
// =============================================================================

/**
 * Categoría de cliente para filtrado en drill-down
 */
export type ClientCategory =
  | 'NUEVO'
  | 'RENOVADO'
  | 'REINTEGRO'
  | 'ACTIVO'
  | 'FINALIZADO'
  | 'EN_CV'

/**
 * Datos de una localidad para una semana específica
 */
export interface LocalityWeekData {
  /** Rango de la semana */
  weekRange: WeekRange
  /** Clientes activos */
  clientesActivos: number
  /** Clientes al corriente */
  clientesAlCorriente: number
  /** Clientes en CV */
  clientesEnCV: number
  /** Movimientos: nuevos */
  nuevos: number
  /** Movimientos: renovados */
  renovados: number
  /** Movimientos: reintegros (retorno a capital) */
  reintegros: number
  /** Movimientos: finalizados */
  finalizados: number
  /** Balance de la semana */
  balance: number
  /** Si la semana ya está completada (pasó el domingo) */
  isCompleted: boolean
}

/**
 * Resumen mensual de una localidad
 */
export interface LocalitySummary {
  /** Total clientes activos (última semana del mes) */
  totalClientesActivos: number
  /** Total clientes al corriente */
  totalClientesAlCorriente: number
  /** Total clientes en CV */
  totalClientesEnCV: number
  /** Total nuevos en el mes */
  totalNuevos: number
  /** Total renovados en el mes */
  totalRenovados: number
  /** Total reintegros en el mes */
  totalReintegros: number
  /** Total finalizados en el mes */
  totalFinalizados: number
  /** Balance neto del mes */
  balance: number
  /** Promedio de clientes al corriente en semanas completadas */
  alCorrientePromedio: number
  /** Promedio de CV en semanas completadas */
  cvPromedio: number
  /** Porcentaje pagando promedio */
  porcentajePagando: number
}

/**
 * Desglose completo de una localidad con datos semanales
 */
export interface LocalityBreakdown {
  /** ID de la localidad */
  localityId: string
  /** Nombre de la localidad */
  localityName: string
  /** ID de la ruta (opcional) */
  routeId?: string
  /** Nombre de la ruta (opcional) */
  routeName?: string
  /** Datos por semana */
  weeklyData: LocalityWeekData[]
  /** Resumen mensual */
  summary: LocalitySummary
}

/**
 * Reporte completo por localidad
 */
export interface LocalityReport {
  /** Tipo de período */
  periodType: PeriodType
  /** Año */
  year: number
  /** Mes */
  month?: number
  /** Número de semana (para reporte semanal) */
  weekNumber?: number
  /** Semanas incluidas en el reporte */
  weeks: WeekRange[]
  /** Desglose por localidad */
  localities: LocalityBreakdown[]
  /** Totales globales */
  totals: LocalitySummary
}

/**
 * Detalle de cliente para drill-down en localidad
 */
export interface LocalityClientDetail {
  /** ID del préstamo */
  loanId: string
  /** Nombre del cliente */
  clientName: string
  /** Código de cliente */
  clientCode: string
  /** Monto otorgado */
  amountGived: number
  /** Monto pendiente */
  pendingAmount: number
  /** Fecha de firma */
  signDate: Date
  /** Estado de CV */
  cvStatus: CVStatus
  /** Días desde último pago */
  daysSinceLastPayment: number | null
  /** Tipo de préstamo */
  loanType: string
  /** Categoría del cliente */
  category: ClientCategory
  /** Pago semanal esperado */
  expectedWeekly: number
  /** Monto pagado en la semana analizada */
  paidThisWeek: number
}
