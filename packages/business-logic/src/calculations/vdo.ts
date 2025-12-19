/**
 * VDO (Valor de Deuda Observada) Calculations
 *
 * Cálculos para determinar el monto adeudado por un préstamo basado en
 * las semanas sin pago y el sobrepago acumulado (abono parcial).
 */

export interface LoanLike {
  id?: string;
  signDate: string;
  expectedWeeklyPayment?: number | string;
  requestedAmount?: number | string;
  loantype?: { weekDuration?: number; rate?: number | string } | null;
  payments?: Array<{ amount: number | string; receivedAt?: string; createdAt?: string }>;
}

export interface VDOResult {
  expectedWeeklyPayment: number;
  weeksWithoutPayment: number;
  arrearsAmount: number;          // Monto adeudado (PAGO VDO)
  partialPayment: number;         // Abono parcial (sobrepago disponible)
}

export interface AbonoParcialResult {
  expectedWeeklyPayment: number;
  totalPaidInCurrentWeek: number;
  abonoParcialAmount: number;
}

/**
 * Convierte un valor a número, manejando strings, undefined y null
 */
function toNumber(value: number | string | undefined | null): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;
  const n = parseFloat(String(value));
  return isNaN(n) ? 0 : n;
}

/**
 * Calcula el pago semanal esperado de un préstamo
 * Usa expectedWeeklyPayment si está disponible, de lo contrario lo calcula
 */
export function computeExpectedWeeklyPayment(loan: LoanLike): number {
  const direct = toNumber(loan.expectedWeeklyPayment as any);
  if (direct > 0) return direct;

  const rate = toNumber(loan.loantype?.rate as any);
  const duration = loan.loantype?.weekDuration ?? 0;
  const principal = toNumber(loan.requestedAmount as any);

  if (duration && principal) {
    const total = principal * (1 + rate);
    return total / duration;
  }

  return 0;
}

/**
 * Obtiene el lunes de una fecha en formato ISO (lunes = 0)
 */
function getIsoMonday(d: Date): Date {
  const date = new Date(d);
  const isoDow = (date.getUTCDay() + 6) % 7; // 0=lunes
  date.setUTCDate(date.getUTCDate() - isoDow);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * Calcula el VDO (Valor de Deuda Observada) para un préstamo
 *
 * @param loan - Datos del préstamo
 * @param now - Fecha actual de referencia
 * @param weekMode - 'current' para semana en curso, 'next' para siguiente semana
 *
 * @returns VDOResult con información de deuda y sobrepago
 *
 * Lógica:
 * - Para 'current': evalúa hasta el domingo anterior (semana pasada completa)
 * - Para 'next': evalúa hasta el domingo actual (semana actual completa)
 * - La semana de firma (semana 0) no cuenta para VDO
 * - El sobrepago se acumula entre semanas
 * - No se arrastra déficit entre semanas
 */
export function calculateVDOForLoan(
  loan: LoanLike,
  now: Date,
  weekMode: 'current' | 'next' = 'current'
): VDOResult {
  const expectedWeeklyPayment = computeExpectedWeeklyPayment(loan);
  const signDate = new Date(loan.signDate);

  // Calcular la fecha límite de evaluación según el modo de semana
  const weekStart = getIsoMonday(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  // Para semana en curso: evaluar solo hasta el final de la semana anterior
  // Para semana siguiente: evaluar hasta el final de la semana actual
  const previousWeekEnd = new Date(weekStart);
  previousWeekEnd.setDate(weekStart.getDate() - 1);
  previousWeekEnd.setHours(23, 59, 59, 999);

  const evaluationEndDate = weekMode === 'current'
    ? previousWeekEnd // Final de la semana anterior (domingo anterior)
    : weekEnd;         // Final de la semana actual (domingo actual)

  // Generar semanas desde el lunes de la semana de firma
  const weeks: Array<{ monday: Date; sunday: Date }> = [];
  let currentMonday = getIsoMonday(signDate);

  while (currentMonday <= evaluationEndDate) {
    const end = new Date(currentMonday);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    // Solo agregar la semana si su domingo no excede la fecha límite
    if (end <= evaluationEndDate) {
      weeks.push({ monday: new Date(currentMonday), sunday: end });
    }

    currentMonday.setDate(currentMonday.getDate() + 7);
  }

  let surplusAccumulated = 0;
  let weeksWithoutPayment = 0;

  // Procesar cada semana
  for (let i = 0; i < weeks.length; i++) {
    const week = weeks[i];
    if (week.sunday > evaluationEndDate) break;

    // Total pagado en la semana
    let weeklyPaid = 0;
    for (const p of loan.payments || []) {
      const dtStr = p.receivedAt || p.createdAt;
      if (!dtStr) continue;
      const dt = new Date(dtStr);
      if (dt >= week.monday && dt <= week.sunday) {
        weeklyPaid += toNumber(p.amount);
      }
    }

    // La semana de firma (i=0) no cuenta para VDO
    // Cualquier pago en esa semana se considera sobrepago completo
    if (i === 0) {
      if (weeklyPaid > 0) {
        surplusAccumulated = weeklyPaid;
      }
      continue;
    }

    // El sobrepago se acumula, pero el déficit no se arrastra entre semanas
    const totalAvailableForWeek = surplusAccumulated + weeklyPaid;
    const isWeekCovered = totalAvailableForWeek >= expectedWeeklyPayment;

    if (!isWeekCovered) weeksWithoutPayment++;

    // Actualizar el sobrepago acumulado
    // Solo se acumula sobrepago positivo, no déficit
    if (totalAvailableForWeek > expectedWeeklyPayment) {
      surplusAccumulated = totalAvailableForWeek - expectedWeeklyPayment;
    } else {
      surplusAccumulated = 0; // No arrastrar déficit
    }
  }

  // Calcular deuda total pendiente
  const totalDebt = loan.requestedAmount
    ? toNumber(loan.requestedAmount) * (1 + toNumber(loan.loantype?.rate || 0))
    : 0;

  let totalPaid = 0;
  for (const p of loan.payments || []) {
    totalPaid += toNumber(p.amount);
  }
  const pendingAmount = Math.max(0, totalDebt - totalPaid);

  // El PAGO VDO no puede ser mayor a la deuda total pendiente
  const arrearsAmount = Math.min(
    weeksWithoutPayment * expectedWeeklyPayment,
    pendingAmount
  );

  return {
    expectedWeeklyPayment,
    weeksWithoutPayment,
    arrearsAmount,
    partialPayment: Math.max(0, surplusAccumulated)
  };
}

/**
 * Calcula el abono parcial para un préstamo en la semana actual
 *
 * @param loan - Datos del préstamo
 * @param now - Fecha actual de referencia
 *
 * @returns AbonoParcialResult con el sobrepago de la semana actual
 */
export function calculateAbonoParcialForLoan(
  loan: LoanLike,
  now: Date
): AbonoParcialResult {
  const expectedWeeklyPayment = computeExpectedWeeklyPayment(loan);
  const weekStart = getIsoMonday(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  let totalPaidInCurrentWeek = 0;
  for (const p of loan.payments || []) {
    const dtStr = p.receivedAt || p.createdAt;
    if (!dtStr) continue;
    const dt = new Date(dtStr);
    if (dt >= weekStart && dt <= weekEnd) {
      totalPaidInCurrentWeek += toNumber(p.amount);
    }
  }

  const abonoParcialAmount = Math.max(0, totalPaidInCurrentWeek - expectedWeeklyPayment);

  return {
    expectedWeeklyPayment,
    totalPaidInCurrentWeek,
    abonoParcialAmount
  };
}
