/**
 * Interfaz para snapshot histórico de préstamo
 *
 * NOTA: La ruta ya NO se guarda en el snapshot del préstamo.
 * La ruta se determina dinámicamente usando LocationHistoryService
 * basado en el historial de la localidad del borrower.
 */
export interface LoanSnapshot {
  snapshotLeadId: string
  snapshotLeadAssignedAt: Date
}

/**
 * Crea un snapshot de los datos históricos del préstamo
 * Este snapshot preserva quién era el líder al momento del desembolso
 *
 * NOTA: La ruta ya NO se guarda aquí. Se usa LocationHistoryService
 * para determinar la ruta basada en el historial de la localidad.
 */
export function createLoanSnapshot(leadId: string): LoanSnapshot {
  return {
    snapshotLeadId: leadId,
    snapshotLeadAssignedAt: new Date(),
  }
}
