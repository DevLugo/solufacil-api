// Utilidades para generar cronología de pagos y períodos sin pago
// Sincronizada entre PDF y frontend

export interface PaymentChronologyItem {
  id: string
  date: string
  dateFormatted: string
  type: 'PAYMENT' | 'NO_PAYMENT'
  description: string
  amount?: number
  paymentMethod?: string
  balanceBefore?: number
  balanceAfter?: number
  paymentNumber?: number
  weekCount?: number
  // Enriquecimiento para colorear por semana
  weekIndex?: number // 1..N
  weeklyExpected?: number
  weeklyPaid?: number
  surplusBefore?: number
  surplusAfter?: number
  coverageType?: 'FULL' | 'COVERED_BY_SURPLUS' | 'PARTIAL' | 'MISS'
}

export interface LoanData {
  id: string
  signDate: string
  weekDuration?: number
  status?: string
  finishedDate?: string
  badDebtDate?: string
  amountGived?: number
  profitAmount?: number
  // Campos alternativos para compatibilidad con getClientHistory
  amountRequested?: number
  interestAmount?: number
  totalAmountDue?: number
  payments?: Array<{
    id: string
    receivedAt: string
    receivedAtFormatted?: string
    amount: number
    paymentMethod: string
    balanceBeforePayment: number
    balanceAfterPayment: number
    paymentNumber?: number
  }>
}

export const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('es-SV', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

// Función auxiliar para verificar si un préstamo está completamente pagado
const isLoanFullyPaid = (loan: LoanData): boolean => {
  // Solo considerar completamente pagado si está marcado como terminado o renovado
  return false // Siempre retornar false para permitir la generación correcta de cronología
}

// Función para generar cronología de pagos y períodos sin pago (sincronizada con PDF)
export const generatePaymentChronology = (loan: LoanData): PaymentChronologyItem[] => {
  const chronology: PaymentChronologyItem[] = []

  if (!loan.signDate) return chronology

  const signDate = new Date(loan.signDate)
  const now = new Date()

  // Determinar hasta cuándo evaluar el crédito
  let endDate: Date

  // Si el crédito está terminado, usar la fecha de finalización
  if (loan.finishedDate && loan.status === 'FINISHED') {
    endDate = new Date(loan.finishedDate)
  }
  // Si está marcado como cartera muerta, usar esa fecha
  else if (loan.badDebtDate) {
    endDate = new Date(loan.badDebtDate)
  }
  // Si está completamente pagado (verificar por monto), usar la fecha actual
  else if (isLoanFullyPaid(loan)) {
    endDate = now
  }
  // Si está activo, evaluar hasta la fecha actual o hasta un máximo razonable
  else {
    // Calcular un máximo de semanas basado en el monto del crédito
    const amount = loan.amountGived || loan.amountRequested || 0
    const maxWeeks = Math.max(loan.weekDuration || 12, Math.ceil(amount / 100)) // 1 semana por cada $100 prestados
    const maxEndDate = new Date(signDate)
    maxEndDate.setDate(maxEndDate.getDate() + maxWeeks * 7)
    endDate = new Date(Math.min(now.getTime(), maxEndDate.getTime()))
  }

  // Calcular el número total de semanas a evaluar
  let totalWeeks: number
  if (loan.finishedDate && loan.status === 'FINISHED') {
    totalWeeks = Math.ceil((new Date(loan.finishedDate).getTime() - signDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
  } else if (loan.badDebtDate) {
    totalWeeks = Math.ceil((new Date(loan.badDebtDate).getTime() - signDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
  } else {
    const amount = loan.amountGived || loan.amountRequested || 0
    const maxWeeks = Math.max(loan.weekDuration || 12, Math.ceil(amount / 100))
    totalWeeks = Math.min(maxWeeks, Math.ceil((endDate.getTime() - signDate.getTime()) / (7 * 24 * 60 * 60 * 1000)))
  }

  // Ordenar pagos por fecha (crear una copia para evitar mutación)
  const sortedPayments = [...(loan.payments || [])].sort(
    (a: any, b: any) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime()
  )

  // Calcular cuota esperada semanal
  const totalDue = loan.totalAmountDue != null ? loan.totalAmountDue : (loan.amountGived || 0) + (loan.profitAmount || 0)
  const durationWeeks = loan.weekDuration || 16
  const expectedWeekly = durationWeeks > 0 ? totalDue / durationWeeks : 0

  // Generar cronología semana por semana
  for (let week = 1; week <= totalWeeks; week++) {
    // Calcular la fecha de pago de esta semana (signDate + week * 7 días)
    const weekPaymentDate = new Date(signDate)
    weekPaymentDate.setDate(weekPaymentDate.getDate() + week * 7)

    // La semana de pago termina el domingo de esa semana
    const weekEndDate = new Date(weekPaymentDate)
    const dayOfWeek = weekEndDate.getDay() // 0 = domingo, 1 = lunes, etc.
    const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek // Días hasta el domingo
    weekEndDate.setDate(weekEndDate.getDate() + daysToSunday)
    weekEndDate.setHours(23, 59, 59, 999) // Final del domingo

    // Calcular lunes y domingo para la semana
    const weekMonday = new Date(weekPaymentDate)
    {
      const dayOfWeekMonday = weekMonday.getDay()
      const daysToMonday = dayOfWeekMonday === 0 ? -6 : 1 - dayOfWeekMonday // Lunes = 1
      weekMonday.setDate(weekMonday.getDate() + daysToMonday)
      weekMonday.setHours(0, 0, 0, 0)
    }
    const weekSunday = new Date(weekMonday)
    weekSunday.setDate(weekSunday.getDate() + 6)
    weekSunday.setHours(23, 59, 59, 999)

    // Buscar TODOS los pagos en esta semana (lunes a domingo)
    const paymentsInWeek = sortedPayments.filter((payment: any) => {
      const paymentDate = new Date(payment.receivedAt)
      return paymentDate >= weekMonday && paymentDate <= weekSunday
    })

    // Calcular pagado antes de la semana y en la semana
    const paidBeforeWeek = (loan.payments || []).reduce((sum, p) => {
      const d = new Date(p.receivedAt).getTime()
      return d < weekMonday.getTime() ? sum + (p.amount || 0) : sum
    }, 0)
    const weeklyPaid = paymentsInWeek.reduce((sum: number, p: any) => sum + (p.amount || 0), 0)
    const expectedBefore = (week - 1) * expectedWeekly
    const surplusBefore = paidBeforeWeek - expectedBefore
    const coversWithSurplus = surplusBefore + weeklyPaid >= expectedWeekly && expectedWeekly > 0
    let coverageType: 'FULL' | 'COVERED_BY_SURPLUS' | 'PARTIAL' | 'MISS' = 'MISS'
    if (weeklyPaid >= expectedWeekly) coverageType = 'FULL'
    else if (coversWithSurplus && weeklyPaid > 0) coverageType = 'COVERED_BY_SURPLUS'
    else if (coversWithSurplus && weeklyPaid === 0) coverageType = 'COVERED_BY_SURPLUS'
    else if (weeklyPaid > 0) coverageType = 'PARTIAL'

    // Agregar todos los pagos encontrados en esta semana
    if (paymentsInWeek.length > 0) {
      paymentsInWeek.forEach((payment: any, index: number) => {
        chronology.push({
          id: `payment-${payment.id}`,
          date: payment.receivedAt,
          dateFormatted: payment.receivedAtFormatted || formatDate(payment.receivedAt),
          type: 'PAYMENT',
          description:
            paymentsInWeek.length > 1 ? `Pago #${index + 1} (${index + 1}/${paymentsInWeek.length})` : `Pago #${payment.paymentNumber || index + 1}`,
          amount: payment.amount,
          paymentMethod: payment.paymentMethod,
          balanceBefore: payment.balanceBeforePayment,
          balanceAfter: payment.balanceAfterPayment,
          paymentNumber: payment.paymentNumber || index + 1,
          weekIndex: week,
          weeklyExpected: expectedWeekly,
          weeklyPaid,
          surplusBefore,
          surplusAfter: surplusBefore + weeklyPaid - expectedWeekly,
          coverageType,
        })
      })
    } else {
      // Solo agregar "sin pago" si la semana ya terminó Y el crédito no está terminado/renovado
      const weekIsBeforeFinish = !loan.finishedDate || weekPaymentDate <= new Date(loan.finishedDate)
      const weekIsBeforeDeadDebt = !loan.badDebtDate || weekPaymentDate <= new Date(loan.badDebtDate)
      const isFullyPaid = isLoanFullyPaid(loan)

      // Mostrar "sin pago" si:
      // 1. La semana ya terminó (now > weekEndDate)
      // 2. La semana está dentro del período activo del crédito
      // 3. El crédito no está completamente pagado
      const shouldShowNoPayment = now > weekEndDate && weekIsBeforeFinish && weekIsBeforeDeadDebt && !isFullyPaid

      if (shouldShowNoPayment) {
        // Determinar si la falta está cubierta por sobrepago previo
        const coverageForNoPayment: 'FULL' | 'COVERED_BY_SURPLUS' | 'PARTIAL' | 'MISS' =
          surplusBefore >= expectedWeekly && expectedWeekly > 0 ? 'COVERED_BY_SURPLUS' : 'MISS'
        const desc = coverageForNoPayment === 'COVERED_BY_SURPLUS' ? 'Sin pago (cubierto por sobrepago)' : 'Sin pago'
        chronology.push({
          id: `no-payment-${week}`,
          date: weekPaymentDate.toISOString(),
          dateFormatted: formatDate(weekPaymentDate.toISOString()),
          type: 'NO_PAYMENT',
          description: desc,
          weekCount: 1,
          weekIndex: week,
          weeklyExpected: expectedWeekly,
          weeklyPaid: 0,
          surplusBefore,
          surplusAfter: surplusBefore - expectedWeekly,
          coverageType: coverageForNoPayment,
        })
      }
    }
  }

  // Agregar pagos que estén fuera del período de semanas regulares
  const regularPayments = chronology.filter((item) => item.type === 'PAYMENT')
  const regularPaymentIds = new Set(regularPayments.map((p) => p.id))
  const isClosedLoan = !!loan.finishedDate && loan.status === 'FINISHED'

  sortedPayments.forEach((payment: any) => {
    const paymentId = `payment-${payment.id}`
    if (!regularPaymentIds.has(paymentId)) {
      const paymentDate = new Date(payment.receivedAt)

      const isInRangeForClosed = paymentDate >= signDate && paymentDate <= endDate
      const isInRangeForActiveOrDeadDebt = paymentDate >= signDate

      if ((isClosedLoan && isInRangeForClosed) || (!isClosedLoan && isInRangeForActiveOrDeadDebt)) {
        chronology.push({
          id: paymentId,
          date: payment.receivedAt,
          dateFormatted: payment.receivedAtFormatted || formatDate(payment.receivedAt),
          type: 'PAYMENT',
          description: `Pago #${payment.paymentNumber || 'adicional'}`,
          amount: payment.amount,
          paymentMethod: payment.paymentMethod,
          balanceBefore: payment.balanceBeforePayment,
          balanceAfter: payment.balanceAfterPayment,
          paymentNumber: payment.paymentNumber,
        })
      }
    }
  })

  // Ordenar cronología por fecha
  return chronology.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}
