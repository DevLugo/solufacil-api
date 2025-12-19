import PDFDocument from 'pdfkit'
import type { ClientHistoryData, LoanHistoryDetail } from './ClientHistoryService'

interface PdfGenerateOptions {
  detailed: boolean
}

export class PdfService {
  private formatCurrency(amount: string | number): string {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(numAmount)) return '$0'
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(numAmount)
  }

  private formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleDateString('es-MX', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  private getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      ACTIVE: 'Activo',
      FINISHED: 'Terminado',
      RENOVATED: 'Renovado',
      CANCELLED: 'Cancelado',
    }
    return labels[status] || status
  }

  private getPaymentMethodLabel(method: string): string {
    const labels: Record<string, string> = {
      CASH: 'Efectivo',
      MONEY_TRANSFER: 'Transferencia',
      CHECK: 'Cheque',
      CARD: 'Tarjeta',
    }
    return labels[method] || method
  }

  async generateClientHistoryPdf(
    data: ClientHistoryData,
    options: PdfGenerateOptions
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 40, bottom: 40, left: 40, right: 40 },
      })

      doc.on('data', (chunk) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const { client, summary, loansAsClient, loansAsCollateral } = data
      const pageWidth = doc.page.width - 80 // margins

      // Header
      doc.fontSize(18).font('Helvetica-Bold').text('Historial de Cliente', { align: 'center' })
      doc.moveDown(0.5)
      doc.fontSize(10).font('Helvetica').text(`Generado: ${this.formatDate(new Date())}`, { align: 'center' })
      doc.moveDown()

      // Client Info Box
      doc.rect(40, doc.y, pageWidth, 70).stroke()
      const boxY = doc.y + 10
      doc.fontSize(12).font('Helvetica-Bold').text(client.fullName, 50, boxY)
      doc.fontSize(9).font('Helvetica')
      doc.text(`Código: ${client.clientCode}`, 50, boxY + 18)
      doc.text(`Teléfono: ${client.phones[0] || 'N/A'}`, 50, boxY + 32)

      // Leader info on the right
      if (client.leader) {
        doc.text(`Líder: ${client.leader.name}`, 300, boxY + 18)
        doc.text(`Ruta: ${client.leader.route}`, 300, boxY + 32)
        doc.text(`Localidad: ${client.leader.location}`, 300, boxY + 46)
      }

      doc.y = boxY + 65
      doc.moveDown()

      // Summary Section
      doc.fontSize(12).font('Helvetica-Bold').text('Resumen', { underline: true })
      doc.moveDown(0.3)
      doc.fontSize(9).font('Helvetica')

      const summaryData = [
        ['Préstamos como Cliente:', summary.totalLoansAsClient.toString()],
        ['Préstamos como Aval:', summary.totalLoansAsCollateral.toString()],
        ['Activos como Cliente:', summary.activeLoansAsClient.toString()],
        ['Activos como Aval:', summary.activeLoansAsCollateral.toString()],
        ['Total Pagado:', this.formatCurrency(summary.totalAmountPaidAsClient)],
        ['Deuda Pendiente:', this.formatCurrency(summary.currentPendingDebtAsClient)],
      ]

      const colWidth = pageWidth / 2
      let row = 0
      summaryData.forEach(([label, value], idx) => {
        const col = idx % 2
        if (col === 0 && idx > 0) row++
        const x = 50 + col * colWidth
        const y = doc.y + row * 14
        doc.text(`${label} ${value}`, x, y)
      })

      doc.y = doc.y + (Math.ceil(summaryData.length / 2)) * 14
      doc.moveDown()

      // Loans as Client
      if (loansAsClient.length > 0) {
        this.addLoansSection(doc, 'Préstamos como Cliente', loansAsClient, options.detailed, pageWidth)
      }

      // Loans as Collateral
      if (loansAsCollateral.length > 0) {
        this.addLoansSection(doc, 'Préstamos como Aval', loansAsCollateral, options.detailed, pageWidth)
      }

      // Footer
      const totalPages = doc.bufferedPageRange().count
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i)
        doc.fontSize(8).font('Helvetica').fillColor('#666666')
        doc.text(
          `Página ${i + 1} de ${totalPages} | SoluFácil`,
          40,
          doc.page.height - 30,
          { align: 'center', width: pageWidth }
        )
      }

      doc.end()
    })
  }

  private addLoansSection(
    doc: PDFKit.PDFDocument,
    title: string,
    loans: LoanHistoryDetail[],
    detailed: boolean,
    pageWidth: number
  ) {
    // Check if we need a new page
    if (doc.y > doc.page.height - 150) {
      doc.addPage()
    }

    doc.fillColor('#000000')
    doc.fontSize(12).font('Helvetica-Bold').text(title, { underline: true })
    doc.moveDown(0.3)

    loans.forEach((loan, index) => {
      // Check if we need a new page for each loan
      if (doc.y > doc.page.height - 200) {
        doc.addPage()
      }

      // Loan header
      doc.fontSize(10).font('Helvetica-Bold')
      doc.text(`${index + 1}. ${loan.signDateFormatted} - ${this.getStatusLabel(loan.status)}`)
      doc.moveDown(0.2)

      // Loan details in a grid
      doc.fontSize(9).font('Helvetica')
      const loanDetails = [
        ['Prestado:', this.formatCurrency(loan.amountRequested)],
        ['Total a Pagar:', this.formatCurrency(loan.totalAmountDue)],
        ['Pagado:', this.formatCurrency(loan.totalPaid)],
        ['Pendiente:', this.formatCurrency(loan.pendingDebt)],
        ['Duración:', `${loan.weekDuration} semanas`],
        ['Tasa:', `${loan.rate}%`],
      ]

      const colWidth = pageWidth / 3
      let row = 0
      loanDetails.forEach(([label, value], idx) => {
        const col = idx % 3
        if (col === 0 && idx > 0) row++
        const x = 50 + col * colWidth
        const y = doc.y + row * 12
        doc.text(`${label} ${value}`, x, y)
      })

      doc.y = doc.y + (Math.ceil(loanDetails.length / 3)) * 12
      doc.moveDown(0.3)

      // Aval/Client info
      if (loan.avalName) {
        doc.fontSize(8).fillColor('#666666').text(`Aval: ${loan.avalName}${loan.avalPhone ? ` (${loan.avalPhone})` : ''}`)
        doc.fillColor('#000000')
      }
      if (loan.clientName) {
        doc.fontSize(8).fillColor('#666666').text(`Cliente: ${loan.clientName}`)
        doc.fillColor('#000000')
      }

      // Payment details (only in detailed mode)
      if (detailed && loan.payments.length > 0) {
        doc.moveDown(0.3)
        doc.fontSize(8).font('Helvetica-Bold').text('Historial de Pagos:')
        doc.font('Helvetica')

        // Table header
        const tableY = doc.y + 5
        const colWidths = [30, 80, 80, 80, 80]
        const headers = ['#', 'Fecha', 'Monto', 'Método', 'Saldo']

        doc.fontSize(7).font('Helvetica-Bold')
        headers.forEach((header, i) => {
          const x = 50 + colWidths.slice(0, i).reduce((a, b) => a + b, 0)
          doc.text(header, x, tableY, { width: colWidths[i] })
        })

        doc.font('Helvetica')
        let paymentY = tableY + 12

        loan.payments.forEach((payment, pIdx) => {
          if (paymentY > doc.page.height - 60) {
            doc.addPage()
            paymentY = 50
          }

          const rowData = [
            (pIdx + 1).toString(),
            payment.receivedAtFormatted,
            this.formatCurrency(payment.amount),
            this.getPaymentMethodLabel(payment.paymentMethod),
            this.formatCurrency(payment.balanceAfterPayment),
          ]

          rowData.forEach((cell, i) => {
            const x = 50 + colWidths.slice(0, i).reduce((a, b) => a + b, 0)
            doc.text(cell, x, paymentY, { width: colWidths[i] })
          })

          paymentY += 10
        })

        doc.y = paymentY
      }

      doc.moveDown()

      // Separator line between loans
      if (index < loans.length - 1) {
        doc.moveTo(50, doc.y).lineTo(pageWidth + 40, doc.y).stroke('#cccccc')
        doc.moveDown(0.5)
      }
    })

    doc.moveDown()
  }
}
