import PDFDocument from 'pdfkit'
import type { PrismaClient } from '@solufacil/database'
import {
  type PortfolioReport,
  type PeriodType,
  formatWeekRange,
} from '@solufacil/business-logic'
import { PortfolioReportService, type PortfolioFilters } from './PortfolioReportService'

export interface PDFGenerationInput {
  periodType: PeriodType
  year: number
  month?: number
  weekNumber?: number
  filters?: PortfolioFilters
}

export interface PDFGenerationResult {
  success: boolean
  base64?: string
  filename: string
  generatedAt: Date
  error?: string
}

// Color palette matching the web app
const COLORS = {
  primary: '#2563eb',       // Blue
  success: '#16a34a',       // Green
  danger: '#dc2626',        // Red
  warning: '#ca8a04',       // Amber
  muted: '#6b7280',         // Gray
  background: '#ffffff',
  text: '#1f2937',
  lightGray: '#f3f4f6',
  border: '#e5e7eb',
}

const FONTS = {
  title: 24,
  subtitle: 16,
  heading: 14,
  body: 11,
  small: 9,
}

export class PortfolioReportPDFService {
  private portfolioService: PortfolioReportService

  constructor(private prisma: PrismaClient) {
    this.portfolioService = new PortfolioReportService(prisma)
  }

  async generatePDF(input: PDFGenerationInput): Promise<PDFGenerationResult> {
    try {
      // Get report data
      const report = input.periodType === 'WEEKLY'
        ? await this.portfolioService.getWeeklyReport(
            input.year,
            input.weekNumber ?? 1,
            input.filters
          )
        : await this.portfolioService.getMonthlyReport(
            input.year,
            input.month ?? 1,
            input.filters
          )

      // Generate PDF
      const base64 = await this.createPDF(report, input)

      // Generate filename
      const periodLabel = input.periodType === 'WEEKLY'
        ? `semana-${input.weekNumber}`
        : `mes-${input.month}`
      const filename = `reporte-cartera-${input.year}-${periodLabel}.pdf`

      return {
        success: true,
        base64,
        filename,
        generatedAt: new Date(),
      }
    } catch (error) {
      console.error('Error generating PDF:', error)
      return {
        success: false,
        filename: 'error.pdf',
        generatedAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  private async createPDF(
    report: PortfolioReport,
    input: PDFGenerationInput
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'LETTER',
          margins: { top: 50, bottom: 50, left: 50, right: 50 },
          bufferPages: true,
        })

        const chunks: Buffer[] = []
        doc.on('data', (chunk) => chunks.push(chunk))
        doc.on('end', () => {
          const buffer = Buffer.concat(chunks)
          resolve(buffer.toString('base64'))
        })
        doc.on('error', reject)

        // Build PDF content
        this.addHeader(doc, report, input)
        this.addSummarySection(doc, report)
        this.addBalanceSection(doc, report)
        this.addRenovationKPIs(doc, report)
        this.addLocationBreakdown(doc, report)
        this.addFooter(doc)

        doc.end()
      } catch (error) {
        reject(error)
      }
    })
  }

  private addHeader(
    doc: PDFKit.PDFDocument,
    report: PortfolioReport,
    input: PDFGenerationInput
  ): void {
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right

    // Title
    doc
      .fontSize(FONTS.title)
      .fillColor(COLORS.text)
      .text('Reporte de Cartera', { align: 'center' })

    // Period info
    const periodText = input.periodType === 'WEEKLY'
      ? `Semana ${input.weekNumber} - ${input.year}`
      : `${this.getMonthName(input.month ?? 1)} ${input.year}`

    doc
      .moveDown(0.5)
      .fontSize(FONTS.subtitle)
      .fillColor(COLORS.muted)
      .text(periodText, { align: 'center' })

    // Week range if available
    if (report.weeklyData.length > 0) {
      const firstWeek = report.weeklyData[0].weekRange
      const lastWeek = report.weeklyData[report.weeklyData.length - 1].weekRange
      const rangeText = input.periodType === 'WEEKLY'
        ? formatWeekRange(firstWeek)
        : `${formatWeekRange(firstWeek)} - ${formatWeekRange(lastWeek)}`

      doc
        .moveDown(0.3)
        .fontSize(FONTS.small)
        .text(rangeText, { align: 'center' })
    }

    // Divider
    doc.moveDown(1)
    this.addDivider(doc)
    doc.moveDown(1)
  }

  private addSummarySection(doc: PDFKit.PDFDocument, report: PortfolioReport): void {
    const { summary } = report
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right

    // Section title
    doc
      .fontSize(FONTS.heading)
      .fillColor(COLORS.primary)
      .text('RESUMEN DE CARTERA', { underline: true })
      .moveDown(0.5)

    // Stats boxes
    const boxWidth = (pageWidth - 30) / 4
    const startX = doc.x
    const startY = doc.y

    // Box 1: Clientes Activos
    this.drawStatBox(doc, startX, startY, boxWidth, {
      label: 'Clientes Activos',
      value: summary.totalClientesActivos.toString(),
      color: COLORS.primary,
    })

    // Box 2: Al Corriente
    this.drawStatBox(doc, startX + boxWidth + 10, startY, boxWidth, {
      label: 'Al Corriente',
      value: summary.clientesAlCorriente.toString(),
      color: COLORS.success,
    })

    // Box 3: En CV
    this.drawStatBox(doc, startX + (boxWidth + 10) * 2, startY, boxWidth, {
      label: 'En Cartera Vencida',
      value: summary.clientesEnCV.toString(),
      color: COLORS.danger,
    })

    // Box 4: % CV
    const cvPercent = summary.totalClientesActivos > 0
      ? ((summary.clientesEnCV / summary.totalClientesActivos) * 100).toFixed(1)
      : '0'
    this.drawStatBox(doc, startX + (boxWidth + 10) * 3, startY, boxWidth, {
      label: '% CV',
      value: `${cvPercent}%`,
      color: COLORS.warning,
    })

    doc.y = startY + 80
    doc.moveDown(1)
  }

  private addBalanceSection(doc: PDFKit.PDFDocument, report: PortfolioReport): void {
    const { clientBalance } = report.summary
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right

    // Section title
    doc
      .fontSize(FONTS.heading)
      .fillColor(COLORS.primary)
      .text('BALANCE DE CLIENTES', { underline: true })
      .moveDown(0.5)

    const colWidth = pageWidth / 4
    const startX = doc.x
    const y = doc.y

    // Nuevos
    doc
      .fontSize(FONTS.body)
      .fillColor(COLORS.success)
      .text(`+${clientBalance.nuevos}`, startX, y, { width: colWidth, align: 'center' })
    doc
      .fontSize(FONTS.small)
      .fillColor(COLORS.muted)
      .text('Nuevos', startX, y + 15, { width: colWidth, align: 'center' })

    // Sin Renovar
    doc
      .fontSize(FONTS.body)
      .fillColor(COLORS.danger)
      .text(`-${clientBalance.terminadosSinRenovar}`, startX + colWidth, y, { width: colWidth, align: 'center' })
    doc
      .fontSize(FONTS.small)
      .fillColor(COLORS.muted)
      .text('Sin Renovar', startX + colWidth, y + 15, { width: colWidth, align: 'center' })

    // Renovados
    doc
      .fontSize(FONTS.body)
      .fillColor(COLORS.primary)
      .text(`${clientBalance.renovados}`, startX + colWidth * 2, y, { width: colWidth, align: 'center' })
    doc
      .fontSize(FONTS.small)
      .fillColor(COLORS.muted)
      .text('Renovados', startX + colWidth * 2, y + 15, { width: colWidth, align: 'center' })

    // Balance Neto
    const balanceColor = clientBalance.balance >= 0 ? COLORS.success : COLORS.danger
    const balancePrefix = clientBalance.balance >= 0 ? '+' : ''
    doc
      .fontSize(FONTS.body)
      .fillColor(balanceColor)
      .text(`${balancePrefix}${clientBalance.balance}`, startX + colWidth * 3, y, { width: colWidth, align: 'center' })
    doc
      .fontSize(FONTS.small)
      .fillColor(COLORS.muted)
      .text('Balance Neto', startX + colWidth * 3, y + 15, { width: colWidth, align: 'center' })

    doc.y = y + 50
    doc.moveDown(1)
  }

  private addRenovationKPIs(doc: PDFKit.PDFDocument, report: PortfolioReport): void {
    const { renovationKPIs } = report
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right

    // Section title
    doc
      .fontSize(FONTS.heading)
      .fillColor(COLORS.primary)
      .text('KPIs DE RENOVACIÓN', { underline: true })
      .moveDown(0.5)

    const startY = doc.y

    // Table header
    const cols = ['Métrica', 'Valor']
    const colWidths = [pageWidth * 0.6, pageWidth * 0.4]

    // Draw header
    doc
      .fontSize(FONTS.small)
      .fillColor(COLORS.text)

    let x = doc.x
    cols.forEach((col, i) => {
      doc.text(col, x, startY, { width: colWidths[i], align: i === 0 ? 'left' : 'right' })
      x += colWidths[i]
    })

    doc.moveDown(0.5)
    this.addDivider(doc, 0.5)
    doc.moveDown(0.3)

    // Data rows
    const data = [
      ['Renovaciones', renovationKPIs.totalRenovaciones.toString()],
      ['Cierres sin Renovar', renovationKPIs.totalCierresSinRenovar.toString()],
      ['Tasa de Renovación', `${(renovationKPIs.tasaRenovacion * 100).toFixed(1)}%`],
    ]

    data.forEach((row) => {
      x = doc.x
      doc.fontSize(FONTS.body)
      row.forEach((cell, i) => {
        const color = i === 0 ? COLORS.text : COLORS.primary
        doc.fillColor(color).text(cell, x, doc.y, { width: colWidths[i], align: i === 0 ? 'left' : 'right' })
        x += colWidths[i]
      })
      doc.moveDown(0.5)
    })

    doc.moveDown(1)
  }

  private addLocationBreakdown(doc: PDFKit.PDFDocument, report: PortfolioReport): void {
    if (report.byLocation.length === 0) return

    // Check if we need a new page
    if (doc.y > doc.page.height - 200) {
      doc.addPage()
    }

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right

    // Section title
    doc
      .fontSize(FONTS.heading)
      .fillColor(COLORS.primary)
      .text('DESGLOSE POR RUTA', { underline: true })
      .moveDown(0.5)

    // Table
    const cols = ['Ruta', 'Activos', 'Al Corriente', 'En CV', '% CV']
    const colWidths = [pageWidth * 0.3, pageWidth * 0.15, pageWidth * 0.2, pageWidth * 0.15, pageWidth * 0.2]

    // Header
    doc.fontSize(FONTS.small).fillColor(COLORS.text)
    let x = doc.x
    cols.forEach((col, i) => {
      doc.text(col, x, doc.y, { width: colWidths[i], align: i === 0 ? 'left' : 'center' })
      x += colWidths[i]
    })

    doc.moveDown(0.5)
    this.addDivider(doc, 0.5)
    doc.moveDown(0.3)

    // Data rows (top 10)
    const locations = report.byLocation.slice(0, 10)
    locations.forEach((loc) => {
      const cvPercent = loc.clientesActivos > 0
        ? ((loc.clientesEnCV / loc.clientesActivos) * 100).toFixed(1)
        : '0'

      x = doc.x
      doc.fontSize(FONTS.body)

      // Ruta name
      doc.fillColor(COLORS.text).text(loc.routeName || loc.locationName, x, doc.y, { width: colWidths[0], align: 'left' })
      x += colWidths[0]

      // Activos
      doc.fillColor(COLORS.text).text(loc.clientesActivos.toString(), x, doc.y, { width: colWidths[1], align: 'center' })
      x += colWidths[1]

      // Al Corriente
      doc.fillColor(COLORS.success).text(loc.clientesAlCorriente.toString(), x, doc.y, { width: colWidths[2], align: 'center' })
      x += colWidths[2]

      // En CV
      doc.fillColor(COLORS.danger).text(loc.clientesEnCV.toString(), x, doc.y, { width: colWidths[3], align: 'center' })
      x += colWidths[3]

      // % CV
      const cvColor = parseFloat(cvPercent) > 20 ? COLORS.danger : parseFloat(cvPercent) > 10 ? COLORS.warning : COLORS.success
      doc.fillColor(cvColor).text(`${cvPercent}%`, x, doc.y, { width: colWidths[4], align: 'center' })

      doc.moveDown(0.7)
    })
  }

  private addFooter(doc: PDFKit.PDFDocument): void {
    const pageHeight = doc.page.height
    const marginBottom = doc.page.margins.bottom

    doc
      .fontSize(FONTS.small)
      .fillColor(COLORS.muted)
      .text(
        `Generado el ${new Date().toLocaleDateString('es-MX', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}`,
        doc.page.margins.left,
        pageHeight - marginBottom + 10,
        { align: 'center' }
      )
  }

  private drawStatBox(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    options: { label: string; value: string; color: string }
  ): void {
    const height = 60
    const padding = 8

    // Background
    doc
      .rect(x, y, width, height)
      .fillColor(COLORS.lightGray)
      .fill()

    // Border
    doc
      .rect(x, y, width, height)
      .strokeColor(COLORS.border)
      .stroke()

    // Color bar on top
    doc
      .rect(x, y, width, 4)
      .fillColor(options.color)
      .fill()

    // Label
    doc
      .fontSize(FONTS.small)
      .fillColor(COLORS.muted)
      .text(options.label, x + padding, y + 12, { width: width - padding * 2, align: 'center' })

    // Value
    doc
      .fontSize(FONTS.subtitle)
      .fillColor(options.color)
      .text(options.value, x + padding, y + 30, { width: width - padding * 2, align: 'center' })
  }

  private addDivider(doc: PDFKit.PDFDocument, opacity: number = 1): void {
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
    doc
      .strokeColor(COLORS.border)
      .opacity(opacity)
      .moveTo(doc.x, doc.y)
      .lineTo(doc.x + pageWidth, doc.y)
      .stroke()
      .opacity(1)
  }

  private getMonthName(month: number): string {
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ]
    return months[month - 1] || ''
  }
}
