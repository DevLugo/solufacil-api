import PDFDocument from 'pdfkit'
import type { PrismaClient } from '@solufacil/database'
import { generatePaymentChronology, type PaymentChronologyItem, type LoanData } from '@solufacil/business-logic'

interface ClientInfo {
  name: string
  clientCode?: string
  phones?: string[]
  addresses?: Array<{
    street: string
    city?: string
    location?: string
    route?: string
  }>
}

interface LoanSummary {
  totalLoansAsClient: number
  totalLoansAsCollateral: number
  activeLoansAsClient: number
  activeLoansAsCollateral: number
  completedLoansAsClient: number
  completedLoansAsCollateral: number
}

interface LoanInfo {
  id: string
  loanType: string
  signDate: string
  finishedDate?: string
  badDebtDate?: string
  status: string
  amountRequested: number
  totalAmountDue: number
  pendingDebt?: number
  weekDuration?: number
  leadName?: string
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

export class PdfExportService {
  constructor(private prisma: PrismaClient) {}

  async generateClientHistoryPDF(clientId: string, detailed: boolean): Promise<Buffer> {
    // Fetch client history data - clientId is a PersonalData ID
    const personalData = await this.prisma.personalData.findUnique({
      where: { id: clientId },
      include: {
        phones: true,
        addresses: {
          include: {
            locationRelation: {
              include: {
                municipalityRelation: {
                  include: {
                    stateRelation: true,
                  },
                },
              },
            },
          },
        },
        borrower: {
          include: {
            loans: {
              include: {
                loantypeRelation: true,
                leadRelation: {
                  include: {
                    personalDataRelation: true,
                  },
                },
                payments: {
                  orderBy: {
                    receivedAt: 'asc',
                  },
                },
              },
              orderBy: {
                signDate: 'desc',
              },
            },
          },
        },
      },
    })

    if (!personalData) {
      throw new Error('Cliente no encontrado')
    }

    // Fetch loans where this person is collateral
    const loansAsCollateral = await this.prisma.loan.findMany({
      where: {
        collaterals: {
          some: {
            id: clientId,
          },
        },
      },
      include: {
        loantypeRelation: true,
        leadRelation: {
          include: {
            personalDataRelation: true,
          },
        },
        borrowerRelation: {
          include: {
            personalDataRelation: true,
          },
        },
      },
      orderBy: {
        signDate: 'desc',
      },
    })

    // Format data
    const clientInfo: ClientInfo = {
      name: personalData.fullName,
      clientCode: personalData.clientCode,
      phones: personalData.phones?.map((p) => p.number) || [],
      addresses:
        personalData.addresses?.map((addr) => ({
          street: addr.street,
          city: addr.locationRelation?.municipalityRelation?.name,
          location: addr.locationRelation?.name,
          route: addr.locationRelation?.name, // TODO: Get actual route if needed
        })) || [],
    }

    // Get loans as client (only if they have a borrower record)
    const loansAsClientData: LoanInfo[] = (personalData.borrower?.loans || []).map((loan) => {
      const amountGived = parseFloat(loan.amountGived.toString())
      const profitAmount = parseFloat(loan.profitAmount.toString())
      const totalAmountDue = amountGived + profitAmount

      // Calculate balance progression for payments
      let runningBalance = totalAmountDue
      const payments = loan.payments.map((p, idx) => {
        const amount = parseFloat(p.amount.toString())
        const balanceBefore = runningBalance
        runningBalance -= amount
        const balanceAfter = Math.max(0, runningBalance)

        return {
          id: p.id,
          receivedAt: p.receivedAt.toISOString(),
          amount,
          paymentMethod: p.paymentMethod,
          balanceBeforePayment: balanceBefore,
          balanceAfterPayment: balanceAfter,
          paymentNumber: idx + 1,
        }
      })

      return {
        id: loan.id,
        loanType: loan.loantypeRelation?.name || 'N/A',
        signDate: loan.signDate.toISOString(),
        finishedDate: loan.finishedDate?.toISOString(),
        status: loan.status,
        amountRequested: amountGived,
        totalAmountDue,
        pendingDebt: parseFloat(loan.pendingAmountStored.toString()),
        weekDuration: loan.loantypeRelation?.weekDuration,
        leadName: loan.leadRelation?.personalDataRelation?.fullName || 'N/A',
        payments,
      }
    })

    const loansAsCollateralData: LoanInfo[] = loansAsCollateral.map((loan) => {
      const amountGived = parseFloat(loan.amountGived.toString())
      const profitAmount = parseFloat(loan.profitAmount.toString())
      const totalAmountDue = amountGived + profitAmount

      return {
        id: loan.id,
        loanType: loan.loantypeRelation?.name || 'N/A',
        signDate: loan.signDate.toISOString(),
        finishedDate: loan.finishedDate?.toISOString(),
        status: loan.status,
        amountRequested: amountGived,
        totalAmountDue,
        leadName: loan.leadRelation?.personalDataRelation?.fullName || 'N/A',
      }
    })

    const summary: LoanSummary = {
      totalLoansAsClient: loansAsClientData.length,
      totalLoansAsCollateral: loansAsCollateralData.length,
      activeLoansAsClient: loansAsClientData.filter((l) => l.status === 'ACTIVE').length,
      activeLoansAsCollateral: loansAsCollateralData.filter((l) => l.status === 'ACTIVE').length,
      completedLoansAsClient: loansAsClientData.filter((l) => l.status === 'FINISHED').length,
      completedLoansAsCollateral: loansAsCollateralData.filter((l) => l.status === 'FINISHED').length,
    }

    // Generate PDF
    return this.createPDF(clientInfo, summary, loansAsClientData, loansAsCollateralData, detailed)
  }

  private createPDF(
    client: ClientInfo,
    summary: LoanSummary,
    loansAsClient: LoanInfo[],
    loansAsCollateral: LoanInfo[],
    detailed: boolean
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const chunks: Buffer[] = []

        const doc = new PDFDocument({
          margin: 40,
          size: 'A4',
          layout: 'portrait',
          bufferPages: true,
          info: {
            Title: `Historial Crediticio - ${client.name}`,
            Author: 'SoluFácil',
            Subject: 'Historial Crediticio del Cliente',
            Creator: 'SoluFácil Sistema de Gestión',
          },
        })

        doc.on('data', (chunk) => chunks.push(chunk))
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)

        // Helper functions
        const formatCurrency = (amount: number): string => {
          return new Intl.NumberFormat('es-SV', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
          }).format(amount)
        }

        const formatDate = (dateString: string): string => {
          return new Date(dateString).toLocaleDateString('es-SV', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          })
        }

        const cleanLoanType = (loanType: string): string => {
          if (!loanType) return 'N/A'
          return loanType
            .replace(/\s*-?\s*\d+(\.\d+)?%.*$/i, '')
            .replace(/\s*\(\d+(\.\d+)?%.*\)$/i, '')
            .replace(/\s*\d+(\.\d+)?%.*$/i, '')
            .trim()
        }

        // Color palette - EXACT system colors from globals.css
        const colors = {
          // Brand colors
          primary: '#F26522',       // Naranja Solufacil
          secondary: '#1A1A3E',     // Azul Marino
          accent: '#FF7A33',        // Naranja hover
          // Backgrounds
          background: '#ffffff',
          card: '#ffffff',
          muted: '#f4f4f5',         // Gray 100
          // Borders
          border: '#e4e4e7',        // Gray 200
          // Text
          foreground: '#1A1A3E',    // Azul Marino
          mutedForeground: '#71717a', // Gray 500
          // Status
          success: '#16a34a',       // Green 600
          successBg: '#f0fdf4',     // Green 50
          warning: '#f59e0b',       // Amber 500
          warningBg: '#fffbeb',     // Amber 50
          destructive: '#ef4444',   // Red 500
          destructiveBg: '#fef2f2', // Red 50
          info: '#0ea5e9',          // Sky 500
          infoBg: '#f0f9ff',        // Sky 50
        }

        // Translate status to Spanish
        const translateStatus = (status: string): string => {
          const translations: Record<string, string> = {
            'ACTIVE': 'ACTIVO',
            'FINISHED': 'TERMINADO',
            'RENEWED': 'RENOVADO',
            'RENOVADO': 'RENOVADO',
            'BAD_DEBT': 'CARTERA VENCIDA',
            'PENDING': 'PENDIENTE',
          }
          return translations[status] || status
        }

        // Header - Clean white with orange accent bar
        const headerHeight = 80

        doc.rect(0, 0, doc.page.width, headerHeight).fill(colors.background)
        doc.rect(0, headerHeight - 4, doc.page.width, 4).fill(colors.primary)

        // Add logo
        const path = require('path')
        const fs = require('fs')
        const possibleLogoPaths = [
          path.join(process.cwd(), '..', 'web', 'public', 'solufacil.png'),
          path.join(process.cwd(), 'apps', 'web', 'public', 'solufacil.png'),
          path.join(__dirname, '..', '..', '..', '..', 'web', 'public', 'solufacil.png'),
        ]
        for (const logoPath of possibleLogoPaths) {
          try {
            if (fs.existsSync(logoPath)) {
              doc.image(logoPath, doc.page.width - 135, 8, { width: 105 })
              break
            }
          } catch (e) {
            // Continue
          }
        }

        // Title
        doc
          .fontSize(20)
          .fillColor(colors.secondary)
          .font('Helvetica-Bold')
          .text('HISTORIAL CREDITICIO', 40, 15, { align: 'left' })

        doc
          .fontSize(9)
          .fillColor(colors.mutedForeground)
          .font('Helvetica')
          .text(
            `${detailed ? 'Reporte Detallado' : 'Reporte Resumen'} • ${new Date().toLocaleDateString('es-SV')} ${new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}`,
            40,
            40,
            { align: 'left' }
          )

        let y = 95

        // Client Information Card
        doc.roundedRect(40, y, doc.page.width - 80, 45, 6).fill(colors.card)
        doc.roundedRect(40, y, doc.page.width - 80, 45, 6).stroke(colors.border)

        y += 10
        doc.fontSize(8).fillColor(colors.mutedForeground).font('Helvetica').text('CLIENTE', 52, y)
        y += 12
        doc.fontSize(12).fillColor(colors.foreground).font('Helvetica-Bold').text(client.name, 52, y)
        if (client.clientCode) {
          doc.fontSize(8).fillColor(colors.mutedForeground).font('Helvetica').text(`Código: ${client.clientCode}`, 280, y + 2)
        }
        if (client.phones && client.phones.length > 0) {
          doc.fontSize(8).fillColor(colors.mutedForeground).font('Helvetica').text(`Tel: ${client.phones[0]}`, 400, y + 2)
        }

        y += 30

        // Executive Summary (only in summary mode)
        if (!detailed && (loansAsClient.length > 0 || loansAsCollateral.length > 0)) {
          doc.roundedRect(40, y, doc.page.width - 80, 65, 6).fill(colors.card)
          doc.roundedRect(40, y, doc.page.width - 80, 65, 6).stroke(colors.border)

          y += 10
          doc.fontSize(8).fillColor(colors.mutedForeground).font('Helvetica').text('RESUMEN', 52, y)
          y += 14

          const totalLoans = summary.totalLoansAsClient + summary.totalLoansAsCollateral
          const activeLoans = summary.activeLoansAsClient + summary.activeLoansAsCollateral

          // Current debt - only show if loan is ACTIVE
          let pendingDebt = 0
          if (loansAsClient.length > 0) {
            const currentLoan = loansAsClient[0]
            if (currentLoan.status === 'ACTIVE') {
              pendingDebt = currentLoan.pendingDebt || 0
            }
          }

          // Metrics in 4-column grid
          const colWidth = (doc.page.width - 110) / 4
          const cols = [52, 52 + colWidth, 52 + colWidth * 2, 52 + colWidth * 3]

          doc.fontSize(8).fillColor(colors.mutedForeground).font('Helvetica')
          doc.text('Total Créditos', cols[0], y)
          doc.text('Activos', cols[1], y)
          doc.text('Saldo Pendiente', cols[2], y)
          doc.text('Cumplimiento', cols[3], y)
          y += 12

          const reliabilityScore = this.calculateReliabilityScore(loansAsClient)

          doc.fontSize(13).fillColor(colors.foreground).font('Helvetica-Bold')
          doc.text(totalLoans.toString(), cols[0], y)
          doc.fillColor(activeLoans > 0 ? colors.primary : colors.foreground).text(activeLoans.toString(), cols[1], y)
          doc.fillColor(pendingDebt > 0 ? colors.destructive : colors.success).text(formatCurrency(pendingDebt), cols[2], y)
          doc.fillColor(reliabilityScore >= 80 ? colors.success : reliabilityScore >= 60 ? colors.warning : colors.destructive)
            .text(`${reliabilityScore}%`, cols[3], y)

          y += 25
        }

        // Loans as Client Section - Focus on Active/Latest Loan
        if (loansAsClient.length > 0) {
          // Get the latest/active loan (first one since ordered by signDate desc)
          const latestLoan = loansAsClient[0]

          if (y > doc.page.height - 180) {
            doc.addPage()
            y = 40
          }

          // Section header - orange background with white text
          y += 15 // Padding before section
          doc.rect(40, y, doc.page.width - 80, 22).fill(colors.primary)
          doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold').text('CRÉDITO ACTUAL', 50, y + 6)
          y += 32 // Padding after header

          // Active Loan Card
          doc.roundedRect(40, y, doc.page.width - 80, 70, 6).fill(colors.card)
          doc.roundedRect(40, y, doc.page.width - 80, 70, 6).stroke(colors.border)

          y += 10
          // Loan type and status badge
          doc.fontSize(11).fillColor(colors.foreground).font('Helvetica-Bold').text(cleanLoanType(latestLoan.loanType), 52, y)
          const translatedStatus = translateStatus(latestLoan.status)
          const statusBgColor = latestLoan.status === 'ACTIVE' ? colors.successBg : latestLoan.status === 'FINISHED' ? colors.muted : colors.warningBg
          const statusTextColor = latestLoan.status === 'ACTIVE' ? colors.success : latestLoan.status === 'FINISHED' ? colors.mutedForeground : colors.warning

          // Status badge
          const statusWidth = doc.widthOfString(translatedStatus) + 14
          doc.roundedRect(doc.page.width - 75 - statusWidth, y - 2, statusWidth, 16, 3).fill(statusBgColor)
          doc.fontSize(8).fillColor(statusTextColor).font('Helvetica-Bold').text(translatedStatus, doc.page.width - 75 - statusWidth + 7, y + 1)
          y += 18

          // Loan details grid
          const gridY = y
          const labelStyle = () => doc.fontSize(8).fillColor(colors.mutedForeground).font('Helvetica')
          const valueStyle = () => doc.fontSize(10).fillColor(colors.foreground).font('Helvetica-Bold')

          labelStyle().text('Fecha Inicio', 52, gridY)
          valueStyle().text(formatDate(latestLoan.signDate), 52, gridY + 10)

          labelStyle().text('Monto', 160, gridY)
          valueStyle().text(formatCurrency(latestLoan.amountRequested), 160, gridY + 10)

          // Only show pending debt if loan is ACTIVE
          labelStyle().text('Saldo Pendiente', 280, gridY)
          const showDebt = latestLoan.status === 'ACTIVE'
          const debtAmount = showDebt ? (latestLoan.pendingDebt || 0) : 0
          valueStyle().fillColor(debtAmount > 0 ? colors.destructive : colors.success).text(
            showDebt ? formatCurrency(debtAmount) : '$0.00',
            280, gridY + 10
          )

          labelStyle().text('Líder', 400, gridY)
          valueStyle().text(latestLoan.leadName || 'N/A', 400, gridY + 10)

          y += 40

          // Payment Table for the active loan
          if (latestLoan.payments && latestLoan.payments.length > 0) {
            // Add spacing before chronology section
            y += 25

            // Check if we have enough space for at least the title + header + a few rows (min 150px)
            if (y > doc.page.height - 150) {
              doc.addPage()
              y = 40
            }

            // Section header - orange background with white text
            doc.rect(40, y, doc.page.width - 80, 22).fill(colors.primary)
            doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold').text('CRONOLOGÍA DE PAGOS', 50, y + 6)
            y += 32 // Padding after header

            // Render table and get the final Y position
            y = this.renderPaymentTableOrange(doc, latestLoan, y, colors)
            y += 15
          } else {
            doc.fontSize(9).fillColor(colors.mutedForeground).font('Helvetica').text('No hay pagos registrados para este crédito.', 52, y)
            y += 20
          }

          // Show other loans summary if detailed mode or if there are more loans
          if (detailed && loansAsClient.length > 1) {
            if (y > doc.page.height - 150) {
              doc.addPage()
              y = 40
            }

            // Section header - orange background with white text
            y += 20 // Padding before section
            doc.rect(40, y, doc.page.width - 80, 22).fill(colors.primary)
            doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold').text('HISTORIAL DE CRÉDITOS ANTERIORES', 50, y + 6)
            y += 32 // Padding after header

            // Show remaining loans (skip the first one which is the active loan)
            loansAsClient.slice(1).forEach((loan, index) => {
              if (y > doc.page.height - 120) {
                doc.addPage()
                y = 40
              }

              // Loan card
              const loanCardHeight = 70
              doc.roundedRect(40, y, doc.page.width - 80, loanCardHeight, 8).fill('#f9fafb')
              doc.roundedRect(40, y, doc.page.width - 80, loanCardHeight, 8).stroke('#d1d5db')

              y += 12
              doc.fontSize(11).fillColor(colors.foreground).font('Helvetica-Bold').text(`${index + 2}. ${cleanLoanType(loan.loanType)}`, 55, y)
              y += 18

              doc.fontSize(9).fillColor(colors.mutedForeground).font('Helvetica')
              doc.text(`Fecha: ${formatDate(loan.signDate)}`, 55, y)
              doc.text(`Monto: ${formatCurrency(loan.amountRequested)}`, 200, y)
              doc.text(`Estado: ${loan.status}`, 350, y)
              y += 15
              doc.text(`Líder: ${loan.leadName}`, 55, y)

              y += 35
            })
          } else if (loansAsClient.length > 1) {
            // In summary mode, just mention there are more loans
            doc.fontSize(10).fillColor(colors.mutedForeground).font('Helvetica').text(
              `Este cliente tiene ${loansAsClient.length - 1} crédito(s) anterior(es). Genere el reporte detallado para ver el historial completo.`,
              55, y
            )
            y += 25
          }
        }

        // Loans as Collateral Section
        if (loansAsCollateral.length > 0) {
          if (y > doc.page.height - 120) {
            doc.addPage()
            y = 40
          }

          // Section header - orange background with white text
          y += 20 // Padding before section
          doc.rect(40, y, doc.page.width - 80, 22).fill(colors.primary)
          doc.fontSize(9).fillColor('#ffffff').font('Helvetica-Bold').text('PRÉSTAMOS COMO AVAL', 50, y + 6)
          y += 32 // Padding after header

          loansAsCollateral.forEach((loan, index) => {
            if (y > doc.page.height - 120) {
              doc.addPage()
              y = 40
            }

            const loanCardHeight = 65
            doc.roundedRect(40, y, doc.page.width - 80, loanCardHeight, 8).fill('#f5f3ff')
            doc.roundedRect(40, y, doc.page.width - 80, loanCardHeight, 8).stroke('#a78bfa')

            y += 12
            doc.fontSize(11).fillColor('#5b21b6').font('Helvetica-Bold').text(`${index + 1}. ${cleanLoanType(loan.loanType)}`, 55, y)
            y += 18

            doc.fontSize(9).fillColor(colors.mutedForeground).font('Helvetica')
            doc.text(`Fecha: ${formatDate(loan.signDate)}`, 55, y)
            doc.text(`Monto: ${formatCurrency(loan.amountRequested)}`, 200, y)
            doc.text(`Estado: ${loan.status}`, 350, y)

            y += 30
          })
        }

        // Get page count and add footers
        const range = doc.bufferedPageRange()
        const pageCount = range.count

        // Only add footers if there's more than one page, otherwise skip
        if (pageCount > 1) {
          for (let i = 0; i < pageCount; i++) {
            doc.switchToPage(i)
            const footerText = `Página ${i + 1} de ${pageCount}`
            const footerY = doc.page.height - 25
            doc.fontSize(8).fillColor('#9ca3af')
            const textWidth = doc.widthOfString(footerText)
            const centerX = (doc.page.width - textWidth) / 2
            doc.text(footerText, centerX, footerY, { lineBreak: false })
          }
        }

        doc.end()
      } catch (error) {
        reject(error)
      }
    })
  }

  private renderPaymentTable(doc: PDFKit.PDFDocument, loan: LoanInfo, startY: number): void {
    const loanData: LoanData = {
      id: loan.id,
      signDate: loan.signDate,
      weekDuration: loan.weekDuration || 16,
      status: loan.status,
      finishedDate: loan.finishedDate,
      totalAmountDue: loan.totalAmountDue,
      amountRequested: loan.amountRequested,
      payments: loan.payments || [],
    }

    const chronology = generatePaymentChronology(loanData)

    // Table headers
    const tableX = 55
    const tableWidth = doc.page.width - 110
    const columnWidths = [
      Math.floor(tableWidth * 0.25), // Fecha
      Math.floor(tableWidth * 0.15), // Tipo
      Math.floor(tableWidth * 0.2), // Monto
      Math.floor(tableWidth * 0.4), // Descripción
    ]

    let y = startY

    // Header row
    doc.rect(tableX, y, tableWidth, 18).fill('#3b82f6')
    doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold')
    const headers = ['Fecha', 'Tipo', 'Monto', 'Descripción']
    headers.forEach((header, i) => {
      const x = tableX + columnWidths.slice(0, i).reduce((a, b) => a + b, 0)
      doc.text(header, x + 5, y + 5, { width: columnWidths[i] - 10, align: 'center' })
    })
    y += 18

    // Data rows
    chronology.forEach((item, index) => {
      // Page break if needed
      if (y > doc.page.height - 100) {
        doc.addPage()
        y = 40
        // Redraw header
        doc.rect(tableX, y, tableWidth, 18).fill('#3b82f6')
        doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold')
        headers.forEach((header, i) => {
          const x = tableX + columnWidths.slice(0, i).reduce((a, b) => a + b, 0)
          doc.text(header, x + 5, y + 5, { width: columnWidths[i] - 10, align: 'center' })
        })
        y += 18
      }

      // Row background
      const bgColor = item.type === 'NO_PAYMENT' && item.coverageType === 'MISS' ? '#fee2e2' : index % 2 === 0 ? '#f9fafb' : '#ffffff'
      doc.rect(tableX, y, tableWidth, 16).fill(bgColor)

      // Row data
      const rowData = [
        item.dateFormatted,
        item.type === 'PAYMENT' ? 'PAGO' : 'SIN PAGO',
        item.type === 'PAYMENT' ? formatCurrency(item.amount || 0) : '-',
        item.description,
      ]

      doc.fontSize(7).fillColor('#1f2937').font('Helvetica')
      rowData.forEach((cell, i) => {
        const x = tableX + columnWidths.slice(0, i).reduce((a, b) => a + b, 0)
        doc.text(cell, x + 5, y + 4, { width: columnWidths[i] - 10, align: 'center' })
      })

      y += 16
    })
  }

  private renderPaymentTableOrange(
    doc: PDFKit.PDFDocument,
    loan: LoanInfo,
    startY: number,
    colors: Record<string, string>
  ): number {
    const loanData: LoanData = {
      id: loan.id,
      signDate: loan.signDate,
      weekDuration: loan.weekDuration || 16,
      status: loan.status,
      finishedDate: loan.finishedDate,
      totalAmountDue: loan.totalAmountDue,
      amountRequested: loan.amountRequested,
      payments: loan.payments || [],
    }

    const chronology = generatePaymentChronology(loanData)

    // Table setup - clean minimal design
    const tableX = 40
    const tableWidth = doc.page.width - 80
    const rowHeight = 16
    const columnWidths = [
      Math.floor(tableWidth * 0.08),  // Semana
      Math.floor(tableWidth * 0.14),  // Fecha
      Math.floor(tableWidth * 0.18),  // Estado (más ancho para indicador)
      Math.floor(tableWidth * 0.15),  // Monto
      Math.floor(tableWidth * 0.45),  // Descripción
    ]

    let y = startY

    // Header row - Clean gray background
    doc.rect(tableX, y, tableWidth, 18).fill('#f8fafc')
    doc.moveTo(tableX, y + 18).lineTo(tableX + tableWidth, y + 18).strokeColor(colors.border).lineWidth(1).stroke()

    doc.fontSize(7).fillColor(colors.mutedForeground).font('Helvetica-Bold')
    const headers = ['SEM', 'FECHA', 'ESTADO', 'MONTO', 'DESCRIPCIÓN']
    headers.forEach((header, i) => {
      const x = tableX + columnWidths.slice(0, i).reduce((a, b) => a + b, 0)
      doc.text(header, x + 4, y + 5, { width: columnWidths[i] - 8, align: i === 3 ? 'right' : 'left' })
    })
    y += 18

    // Data rows - leave 50px margin at bottom for footer
    const bottomMargin = 50
    chronology.forEach((item, index) => {
      // Page break if needed
      if (y + rowHeight > doc.page.height - bottomMargin) {
        doc.addPage()
        y = 40
        // Redraw header on new page
        doc.rect(tableX, y, tableWidth, 18).fill('#f8fafc')
        doc.moveTo(tableX, y + 18).lineTo(tableX + tableWidth, y + 18).strokeColor(colors.border).lineWidth(1).stroke()
        doc.fontSize(7).fillColor(colors.mutedForeground).font('Helvetica-Bold')
        headers.forEach((header, i) => {
          const x = tableX + columnWidths.slice(0, i).reduce((a, b) => a + b, 0)
          doc.text(header, x + 4, y + 5, { width: columnWidths[i] - 8, align: i === 3 ? 'right' : 'left' })
        })
        y += 18
      }

      // Alternating row background - very subtle
      const bgColor = index % 2 === 0 ? '#ffffff' : '#fafafa'
      doc.rect(tableX, y, tableWidth, rowHeight).fill(bgColor)

      // Determine status styling
      let statusText = ''
      let statusColor = colors.mutedForeground
      let indicatorColor = colors.muted

      if (item.type === 'PAYMENT') {
        statusText = 'Pagado'
        statusColor = colors.success
        indicatorColor = colors.success
      } else {
        if (item.coverageType === 'MISS') {
          statusText = 'Falta'
          statusColor = colors.destructive
          indicatorColor = colors.destructive
        } else if (item.coverageType === 'COVERED_BY_SURPLUS') {
          statusText = 'Cubierto'
          statusColor = colors.info
          indicatorColor = colors.info
        } else if (item.coverageType === 'PARTIAL') {
          statusText = 'Parcial'
          statusColor = colors.warning
          indicatorColor = colors.warning
        } else {
          statusText = 'Pendiente'
          statusColor = colors.mutedForeground
          indicatorColor = colors.muted
        }
      }

      // Left border indicator for status (3px colored bar)
      doc.rect(tableX, y, 3, rowHeight).fill(indicatorColor)

      // Row data
      let x = tableX

      // Week number
      doc.fontSize(8).font('Helvetica-Bold').fillColor(colors.foreground)
      doc.text(`${item.weekIndex || '-'}`, x + 6, y + 4, { width: columnWidths[0] - 8, align: 'center' })

      // Date
      x += columnWidths[0]
      doc.fontSize(7).font('Helvetica').fillColor(colors.mutedForeground)
      doc.text(item.dateFormatted, x + 4, y + 5, { width: columnWidths[1] - 8, align: 'left' })

      // Status with colored dot indicator
      x += columnWidths[1]
      // Draw a small colored circle as status indicator
      doc.circle(x + 8, y + rowHeight / 2, 3).fill(indicatorColor)
      doc.fontSize(7).font('Helvetica-Bold').fillColor(statusColor)
      doc.text(statusText, x + 16, y + 5, { width: columnWidths[2] - 20, align: 'left' })

      // Amount
      x += columnWidths[2]
      if (item.type === 'PAYMENT') {
        doc.fontSize(8).font('Helvetica-Bold').fillColor(colors.success)
        doc.text(formatCurrency(item.amount || 0), x + 4, y + 4, { width: columnWidths[3] - 8, align: 'right' })
      } else {
        doc.fontSize(7).font('Helvetica').fillColor(colors.muted)
        doc.text('—', x + 4, y + 5, { width: columnWidths[3] - 8, align: 'right' })
      }

      // Description
      x += columnWidths[3]
      doc.fontSize(6.5).font('Helvetica').fillColor(colors.mutedForeground)
      doc.text(item.description, x + 4, y + 5, { width: columnWidths[4] - 8, align: 'left' })

      // Bottom border for each row
      doc.moveTo(tableX, y + rowHeight).lineTo(tableX + tableWidth, y + rowHeight)
        .strokeColor('#f1f5f9').lineWidth(0.5).stroke()

      y += rowHeight
    })

    // Table bottom border
    doc.moveTo(tableX, y).lineTo(tableX + tableWidth, y).strokeColor(colors.border).lineWidth(1).stroke()

    return y
  }

  private calculateReliabilityScore(loans: LoanInfo[]): number {
    if (loans.length === 0) return 0

    let totalExpected = 0
    let totalMissed = 0

    loans.forEach((loan) => {
      const chronology = generatePaymentChronology({
        id: loan.id,
        signDate: loan.signDate,
        weekDuration: loan.weekDuration || 16,
        status: loan.status,
        finishedDate: loan.finishedDate,
        totalAmountDue: loan.totalAmountDue,
        amountRequested: loan.amountRequested,
        payments: loan.payments || [],
      })

      const weekSet = new Set<number>()
      chronology.forEach((item) => {
        if (item.weekIndex) weekSet.add(item.weekIndex)
      })
      totalExpected += weekSet.size

      const missedWeeks = chronology.filter((item) => item.type === 'NO_PAYMENT' && item.coverageType === 'MISS').length
      totalMissed += missedWeeks
    })

    if (totalExpected === 0) return 0
    return Math.max(0, Math.round(((totalExpected - totalMissed) / totalExpected) * 100))
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-SV', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}
