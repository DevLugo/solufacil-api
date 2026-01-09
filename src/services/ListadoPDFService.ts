import PDFDocument from 'pdfkit'
import type { PrismaClient } from '@solufacil/database'
import { calculateVDOForLoan } from '@solufacil/business-logic'
import path from 'path'

interface ListadoParams {
  localityId: string
  routeId: string
  localityName: string
  routeName: string
  leaderName: string
  leaderId: string
  weekMode: 'current' | 'next'
}

interface PaymentRow {
  id: string
  name: string
  phone: string
  abono: string
  adeudo: string
  plazos: string
  pagoVdo: string
  abonoParcial: string
  fInicio: string
  nSemana: string
  aval: string
}

interface ColumnWidths {
  id: number
  name: number
  phone: number
  abono: number
  adeudo: number
  plazos: number
  pagoVdo: number
  abonoParcial: number
  fInicio: number
  nSemana: number
  aval: number
  [key: string]: number
}

export class ListadoPDFService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Genera un PDF de listado de cobranza para una localidad específica
   */
  async generateListadoPDF(params: ListadoParams): Promise<Buffer> {
    const {
      localityId,
      routeId,
      localityName,
      routeName,
      leaderName,
      leaderId,
      weekMode
    } = params

    // Calcular rango de fechas semanal (ISO: lunes a domingo)
    const today = new Date()
    const weekStart = this.getIsoMonday(today)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    weekEnd.setHours(23, 59, 59, 999)

    if (weekMode === 'next') {
      weekStart.setDate(weekStart.getDate() + 7)
      weekEnd.setDate(weekEnd.getDate() + 7)
    }

    // Obtener préstamos activos
    const activeLoans = await this.getActiveLoans(leaderId)

    // Calcular pendingAmount dinámicamente y filtrar préstamos con monto pendiente > 0
    const filteredActiveLoans = this.filterAndEnrichLoans(activeLoans)

    // Generar registros de pago para el PDF
    const payments = await this.generatePaymentRows(
      filteredActiveLoans,
      weekStart,
      weekEnd,
      weekMode
    )

    // Calcular estadísticas
    const stats = this.calculateStatistics(filteredActiveLoans, payments)

    // Generar PDF
    return this.createPDF({
      routeName,
      localityName,
      leaderName,
      weekStart,
      weekEnd,
      payments,
      stats,
      weekMode
    })
  }

  /**
   * Obtiene préstamos activos de la base de datos
   * Usa status: ACTIVE para ser consistente con transacciones/abonos
   */
  private async getActiveLoans(leaderId?: string) {
    return this.prisma.loan.findMany({
      where: {
        status: 'ACTIVE',
        excludedByCleanup: null,
        ...(leaderId ? { lead: leaderId } : {})
      },
      include: {
        borrowerRelation: {
          include: {
            personalDataRelation: {
              include: {
                phones: { select: { number: true } },
                addresses: { include: { locationRelation: true } }
              }
            }
          }
        },
        collaterals: {
          include: {
            phones: { select: { number: true } }
          }
        },
        loantypeRelation: true,
        payments: true,
        leadRelation: {
          include: {
            personalDataRelation: true
          }
        }
      },
      orderBy: [
        { signDate: 'asc' },
        { id: 'asc' }
      ]
    })
  }

  /**
   * Filtra y enriquece préstamos con monto pendiente calculado
   */
  private filterAndEnrichLoans(loans: any[]) {
    return loans
      .map((loan: any) => {
        const rate = loan.loantypeRelation?.rate ? parseFloat(loan.loantypeRelation.rate.toString()) : 0
        const requestedAmount = parseFloat(loan.requestedAmount?.toString() || '0')
        const totalDebtAcquired = requestedAmount * (1 + rate)

        const totalPaid = (loan.payments || []).reduce((sum: number, payment: any) => {
          return sum + parseFloat(payment.amount?.toString() || '0')
        }, 0)

        const calculatedPendingAmount = totalDebtAcquired - totalPaid

        return {
          ...loan,
          calculatedPendingAmount,
          totalDebtAcquired,
          totalPaid
        }
      })
      .filter((loan: any) => loan.calculatedPendingAmount > 0)
  }

  /**
   * Genera las filas de pago para el PDF
   */
  private async generatePaymentRows(
    loans: any[],
    weekStart: Date,
    weekEnd: Date,
    weekMode: 'current' | 'next'
  ): Promise<PaymentRow[]> {
    return loans.map((loan: any) => {
      const phone = loan.borrowerRelation?.personalDataRelation?.phones?.[0]?.number || ''

      const expectedWeeklyPayment = this.computeExpectedWeeklyPayment(loan)
      const pendingAmountStored = loan.calculatedPendingAmount || 0

      // Calcular VDO usando la función de business-logic
      const loanForCalc = {
        signDate: loan.signDate,
        expectedWeeklyPayment: expectedWeeklyPayment,
        requestedAmount: loan.requestedAmount,
        loantype: loan.loantypeRelation,
        payments: loan.payments || []
      }

      const vdoResult = calculateVDOForLoan(loanForCalc, new Date(), weekMode)
      const arrearsAmount = vdoResult.arrearsAmount
      const abonoParcialAmount = vdoResult.partialPayment

      // Calcular número de semana
      const signDate = new Date(loan.signDate)
      const signWeekStart = this.getIsoMonday(signDate)
      const signWeekEnd = new Date(signWeekStart)
      signWeekEnd.setDate(signWeekEnd.getDate() + 6)
      signWeekEnd.setHours(23, 59, 59, 999)

      const boundary = new Date(signWeekEnd)
      boundary.setDate(boundary.getDate() + 1)
      boundary.setHours(0, 0, 0, 0)

      const msPerWeek = 7 * 24 * 60 * 60 * 1000
      const weeksElapsedSinceBoundary = Math.max(
        0,
        Math.floor((this.getIsoMonday(weekEnd).getTime() - this.getIsoMonday(boundary).getTime()) / msPerWeek)
      )
      const nSemanaValue = weeksElapsedSinceBoundary + 1

      // Texto de AVAL
      let avalDisplay = ''
      if (loan.collaterals && loan.collaterals.length > 0) {
        const primaryCollateral = loan.collaterals[0]
        const avalName = primaryCollateral.fullName || ''
        const avalPhone = primaryCollateral.phones?.[0]?.number || ''
        avalDisplay = [avalName, avalPhone].filter(Boolean).join(', ')
      }

      return {
        id: loan.borrowerRelation?.personalDataRelation?.clientCode || this.shortCodeFromId(loan.borrowerRelation?.personalDataRelation?.id) || '',
        name: loan.borrowerRelation?.personalDataRelation?.fullName || '',
        phone: phone,
        abono: this.formatCurrency(expectedWeeklyPayment || 0),
        adeudo: this.formatCurrency(pendingAmountStored || 0),
        plazos: (loan.loantypeRelation?.weekDuration || 0).toString(),
        pagoVdo: this.formatCurrency(arrearsAmount || 0),
        abonoParcial: this.formatCurrency(abonoParcialAmount || 0),
        fInicio: this.formatDate(loan.signDate),
        nSemana: String(nSemanaValue),
        aval: avalDisplay
      }
    })
  }

  /**
   * Calcula estadísticas del listado
   */
  private calculateStatistics(loans: any[], payments: PaymentRow[]) {
    const totalClientes = payments.length

    const totalCobranzaEsperada = loans.reduce((sum: number, loan: any) => {
      return sum + this.computeExpectedWeeklyPayment(loan)
    }, 0)

    const totalComisionEsperada = loans.reduce((sum: number, loan: any) => {
      if (loan.loantypeRelation?.loanPaymentComission) {
        const commission = parseFloat(loan.loantypeRelation.loanPaymentComission.toString())
        return sum + commission
      }
      return sum
    }, 0)

    return {
      totalClientes,
      totalCobranzaEsperada,
      totalComisionEsperada
    }
  }

  /**
   * Crea el documento PDF
   */
  private createPDF(data: {
    routeName: string
    localityName: string
    leaderName: string
    weekStart: Date
    weekEnd: Date
    payments: PaymentRow[]
    stats: any
    weekMode: 'current' | 'next'
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 30 })
        const chunks: Buffer[] = []

        doc.on('data', (chunk) => chunks.push(chunk))
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)

        // Generar fecha semanal
        const weekRange = `${data.weekStart.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })} al ${data.weekEnd.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}`

        // Header
        const headerY = 25
        doc.fontSize(14).text(data.routeName, 30, headerY, { align: 'left' })
        doc.fontSize(14).text('Listado de Cobranza', 0, headerY, { align: 'center' })

        // Logo
        try {
          const logoPath = path.join(process.cwd(), '../web/public/solufacil.png')
          doc.image(logoPath, 450, 10, { width: 100 })
        } catch (err) {
          console.warn('Logo not found, skipping:', err)
        }

        const subtitleY = headerY + 20
        doc.fontSize(10).text(`Semanal del ${weekRange}`, 0, subtitleY, { align: 'center' })

        const detailsY = subtitleY + 30
        doc.fontSize(8).fillColor('gray').text('Localidad:', 30, detailsY)
        doc.fontSize(8).fillColor('black').text(data.localityName, 100, detailsY)
        doc.fontSize(8).fillColor('gray').text('Líder:', 400, detailsY)
        doc.fontSize(8).fillColor('black').text(data.leaderName || 'Sin asignar', 450, detailsY)

        const additionalDetailsY = detailsY + 15
        doc.fontSize(8).fillColor('black').text(`Total de clientes: ${data.stats.totalClientes}`, 30, additionalDetailsY)
        doc.text(`Comisión a pagar al líder: ${this.formatCurrency(data.stats.totalComisionEsperada)}`, 30, additionalDetailsY + 12)
        doc.text(`Total de cobranza esperada: ${this.formatCurrency(data.stats.totalCobranzaEsperada)}`, 30, additionalDetailsY + 24)

        // Tabla
        let currentY = this.drawTableHeaders(doc, additionalDetailsY + 35)
        let pageNumber = 1
        this.addPageNumber(doc, pageNumber)

        const columnWidths: ColumnWidths = {
          id: 30,
          name: 100,
          phone: 40,
          abono: 70,
          adeudo: 35,
          plazos: 35,
          pagoVdo: 25,
          abonoParcial: 35,
          fInicio: 35,
          nSemana: 40,
          aval: 85
        }

        const pageHeight = doc.page.height - doc.page.margins.bottom
        const paddingBottom = 1
        const lineHeight = 8

        // Dibujar filas
        data.payments.forEach((payment) => {
          doc.fontSize(5)
          const columnKeys = Object.keys(columnWidths)

          const nameOffset = columnKeys.slice(0, columnKeys.indexOf('name')).reduce((sum, key) => sum + columnWidths[key], 0)
          const nameBlockWidth = columnWidths.name - 4
          const nameTextHeight = doc.heightOfString(payment.name || '', { width: nameBlockWidth })

          const avalOffset = columnKeys.slice(0, columnKeys.indexOf('aval')).reduce((sum, key) => sum + columnWidths[key], 0)
          const avalBlockWidth = columnWidths.aval - 4
          const avalTextHeight = doc.heightOfString(payment.aval || '', { width: avalBlockWidth })

          const maxTextHeight = Math.max(nameTextHeight, avalTextHeight)
          const rowHeight = Math.max(maxTextHeight + paddingBottom + 3, 14)

          if (currentY + rowHeight > pageHeight) {
            this.addPageNumber(doc, pageNumber)
            doc.addPage()
            pageNumber++
            currentY = this.drawTableHeaders(doc, 30)
          }

          // Dibujar nombre
          doc.text(payment.name || '', 30 + nameOffset + 2, currentY + 2, { width: nameBlockWidth, align: 'left' })

          // Dibujar otras columnas
          this.drawRow(doc, payment, columnWidths, currentY, rowHeight)

          currentY += rowHeight
        })

        this.addPageNumber(doc, pageNumber)
        doc.end()
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Dibuja los headers de la tabla
   */
  private drawTableHeaders(doc: typeof PDFDocument.prototype, y: number): number {
    const headers = ['ID', 'NOMBRE', 'TELEFONO', 'ABONO', 'ADEUDO', 'PLAZOS', 'PAGO VDO', 'ABONO PARCIAL', 'FECHA INICIO', 'NUMERO SEMANA', 'AVAL']
    const headerHeight = 20

    const columnWidths: ColumnWidths = {
      id: 30,
      name: 100,
      phone: 40,
      abono: 70,
      adeudo: 35,
      plazos: 35,
      pagoVdo: 25,
      abonoParcial: 35,
      fInicio: 35,
      nSemana: 40,
      aval: 85
    }

    doc.rect(30, y, Object.values(columnWidths).reduce((a, b) => a + b, 0), headerHeight).fillAndStroke('#f0f0f0', '#000')
    doc.fillColor('#000').fontSize(6)

    headers.forEach((header, i) => {
      const x = 30 + Object.values(columnWidths).slice(0, i).reduce((a, b) => a + b, 0)
      const columnWidth = Object.values(columnWidths)[i]

      if (header.includes(' ')) {
        const [firstLine, secondLine] = header.split(' ')
        doc.text(firstLine, x, y + 3, { width: columnWidth, align: 'center' })
        doc.text(secondLine, x, y + 12, { width: columnWidth, align: 'center' })
      } else {
        doc.text(header, x, y + 8, { width: columnWidth, align: 'center' })
      }
    })

    doc.lineWidth(0.5)
    let x = 30
    Object.values(columnWidths).forEach((width) => {
      doc.moveTo(x, y).lineTo(x, y + headerHeight).stroke()
      x += width
    })
    doc.moveTo(x, y).lineTo(x, y + headerHeight).stroke()

    return y + headerHeight
  }

  /**
   * Dibuja una fila de la tabla
   */
  private drawRow(doc: typeof PDFDocument.prototype, payment: PaymentRow, columnWidths: ColumnWidths, currentY: number, rowHeight: number) {
    const drawColumn = (key: string, x: number, width: number) => {
      const paddingLeft = key === 'name' ? 2 : 0
      if (key === 'abono') {
        const left = ''
        const right = payment[key]
        const subColumnWidth = width / 2
        const textHeight = Math.max(
          doc.heightOfString(left, { width: subColumnWidth }),
          doc.heightOfString(right, { width: subColumnWidth })
        )
        const verticalOffset = (rowHeight - textHeight) / 2
        doc.text(left, x + paddingLeft, currentY + verticalOffset, { width: subColumnWidth, align: 'center' })
        doc.text(right, x + paddingLeft + subColumnWidth, currentY + verticalOffset, { width: subColumnWidth, align: 'center' })
        doc.moveTo(x + subColumnWidth, currentY).lineTo(x + subColumnWidth, currentY + rowHeight).stroke()
        doc.moveTo(x, currentY).lineTo(x, currentY + rowHeight).stroke()
      } else if (key !== 'name') {
        const value = payment[key as keyof typeof payment]
        const textHeight = doc.heightOfString(value, { width })
        const verticalOffset = (rowHeight - textHeight) / 2

        if (key === 'aval') {
          doc.text(value, x + 2, currentY + 2, { width: width - 4, align: 'left' })
        } else {
          doc.text(value, x + paddingLeft, currentY + verticalOffset, { width, align: 'center' })
        }
      }
    }

    Object.entries(columnWidths).forEach(([key, width], index) => {
      const x = 30 + Object.values(columnWidths).slice(0, index).reduce((a, b) => a + b, 0)
      drawColumn(key, x, width)
    })

    doc.lineWidth(0.5).rect(30, currentY, Object.values(columnWidths).reduce((a, b) => a + b, 0), rowHeight).stroke()

    let x = 30
    Object.values(columnWidths).forEach((width) => {
      doc.moveTo(x, currentY).lineTo(x, currentY + rowHeight).stroke()
      x += width
    })
  }

  /**
   * Agrega número de página
   */
  private addPageNumber(doc: typeof PDFDocument.prototype, pageNumber: number): void {
    doc.fontSize(10).text(`Página ${pageNumber}`, doc.page.width - 100, doc.page.height - 42, { align: 'right' })
  }

  // Utilidades

  private getIsoMonday(d: Date): Date {
    const date = new Date(d)
    const isoDow = (date.getDay() + 6) % 7
    date.setDate(date.getDate() - isoDow)
    date.setHours(0, 0, 0, 0)
    return date
  }

  private computeExpectedWeeklyPayment(loan: any): number {
    const direct = parseFloat(loan.expectedWeeklyPayment?.toString() || '0')
    if (direct > 0) return direct

    const rate = parseFloat(loan.loantypeRelation?.rate?.toString() || '0')
    const duration = loan.loantypeRelation?.weekDuration || 0
    const principal = parseFloat(loan.requestedAmount?.toString() || '0')

    if (duration && principal) {
      const total = principal * (1 + rate)
      return total / duration
    }

    return 0
  }

  private formatCurrency(amount: number | string): string {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(num || 0).replace('MX$', '$')
  }

  private formatDate(dateString: string | null): string {
    if (!dateString) return ''
    const date = new Date(dateString)
    return date.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  }

  private shortCodeFromId(id?: string): string {
    if (!id) return ''
    const base = id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    return base.slice(-6)
  }
}
