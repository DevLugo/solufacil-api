import PDFDocument from 'pdfkit'
import type { PrismaClient } from '@solufacil/database'
import { BadDebtClientsService, type BadDebtClientItem } from './BadDebtClientsService'
import {
  type PDFDoc,
  PDF_COLORS,
  PDF_FONT_SIZES,
  PDF_LAYOUT,
  calculateRowHeight,
  drawCell,
  drawMultiLineCell,
  addPageNumber,
  drawTableHeaderBackground,
  drawLogo,
  formatLongDate,
  formatShortDate,
  formatCurrency,
} from './pdf/pdfUtils'

interface BadDebtPDFParams {
  routeId?: string
  locationId?: string
  routeName?: string
  locationName?: string
}

// Column configuration
const COLUMN_WIDTHS = {
  num: 25,
  client: 110,
  requested: 55,
  paid: 55,
  pending: 55,
  location: 75,
  leader: 75,
  lastPayment: 55,
} as const

const TABLE_HEADERS = [
  { key: 'num', label: '#', align: 'center' as const },
  { key: 'client', label: 'CLIENTE', align: 'left' as const },
  { key: 'requested', label: 'SOLICITADO', align: 'left' as const },
  { key: 'paid', label: 'PAGADO', align: 'left' as const },
  { key: 'pending', label: 'DEBE', align: 'left' as const },
  { key: 'location', label: 'LOCALIDAD', align: 'left' as const },
  { key: 'leader', label: 'LÍDER', align: 'left' as const },
  { key: 'lastPayment', label: 'ÚLT. PAGO', align: 'left' as const },
]

const TOTAL_TABLE_WIDTH = Object.values(COLUMN_WIDTHS).reduce((a, b) => a + b, 0)

export class BadDebtPDFService {
  private badDebtService: BadDebtClientsService

  constructor(private prisma: PrismaClient) {
    this.badDebtService = new BadDebtClientsService(prisma)
  }

  async generatePDF(params: BadDebtPDFParams): Promise<Buffer> {
    const { routeId, locationId, routeName, locationName } = params

    const result = await this.badDebtService.getBadDebtClients({
      routeId,
      locationId,
      limit: 10000,
      offset: 0,
    })

    return this.createPDF({
      clients: result.clients,
      routeName,
      locationName,
      generatedAt: new Date(),
    })
  }

  private createPDF(data: {
    clients: BadDebtClientItem[]
    routeName?: string
    locationName?: string
    generatedAt: Date
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: PDF_LAYOUT.margin })
        const chunks: Buffer[] = []

        doc.on('data', (chunk) => chunks.push(chunk))
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)

        this.drawHeader(doc, data)
        this.drawTotalClients(doc, data.clients.length, 100)

        const pageNumber = this.drawTable(doc, data.clients, 150)
        addPageNumber(doc, pageNumber, PDF_COLORS.textMuted)

        doc.end()
      } catch (error) {
        reject(error)
      }
    })
  }

  private drawHeader(
    doc: PDFDoc,
    data: { routeName?: string; locationName?: string; generatedAt: Date }
  ): void {
    drawLogo(doc, PDF_LAYOUT.margin, 25)

    doc
      .fontSize(PDF_FONT_SIZES.title)
      .fillColor(PDF_COLORS.primary)
      .text('Reporte de Clientes Morosos', 0, 30, { align: 'center' })

    doc
      .fontSize(PDF_FONT_SIZES.small)
      .fillColor(PDF_COLORS.textMuted)
      .text(`Generado el ${formatLongDate(data.generatedAt)}`, 0, 50, { align: 'center' })

    const filters = [
      data.routeName && `Ruta: ${data.routeName}`,
      data.locationName && `Localidad: ${data.locationName}`,
    ].filter(Boolean)

    if (filters.length > 0) {
      doc.text(filters.join(' | '), 0, 65, { align: 'center' })
    }
  }

  private drawTotalClients(doc: PDFDoc, total: number, y: number): void {
    const boxWidth = 150
    const boxHeight = 35
    const x = PDF_LAYOUT.margin + (doc.page.width - PDF_LAYOUT.margin * 2 - boxWidth) / 2

    doc.fillColor(PDF_COLORS.headerBg).rect(x, y, boxWidth, boxHeight).fill()
    doc.fillColor(PDF_COLORS.primary).rect(x, y, 4, boxHeight).fill()

    doc
      .fontSize(PDF_FONT_SIZES.small)
      .fillColor(PDF_COLORS.textMuted)
      .text('Total Clientes Morosos', x + 10, y + 8, { width: boxWidth - 15, align: 'center' })

    doc
      .fontSize(PDF_FONT_SIZES.title)
      .fillColor(PDF_COLORS.primary)
      .text(total.toString(), x + 10, y + 18, { width: boxWidth - 15, align: 'center' })
  }

  private drawTable(doc: PDFDoc, clients: BadDebtClientItem[], startY: number): number {
    let currentY = this.drawTableHeader(doc, startY)
    let pageNumber = 1
    const pageHeight = doc.page.height - PDF_LAYOUT.footerMargin

    for (let i = 0; i < clients.length; i++) {
      const client = clients[i]
      const clientText = this.getClientText(client)
      const rowHeight = this.calculateClientRowHeight(doc, clientText)

      if (currentY + rowHeight > pageHeight) {
        addPageNumber(doc, pageNumber, PDF_COLORS.textMuted)
        doc.addPage()
        pageNumber++
        currentY = this.drawTableHeader(doc, PDF_LAYOUT.margin)
      }

      currentY = this.drawTableRow(doc, client, clientText, i + 1, currentY, rowHeight)
    }

    return pageNumber
  }

  private calculateClientRowHeight(doc: PDFDoc, clientText: string): number {
    return calculateRowHeight(
      doc,
      [{ text: clientText, width: COLUMN_WIDTHS.client - 4 }],
      PDF_FONT_SIZES.tableCell,
      PDF_LAYOUT.minRowHeight
    )
  }

  private drawTableHeader(doc: PDFDoc, y: number): number {
    drawTableHeaderBackground(doc, y, TOTAL_TABLE_WIDTH, PDF_LAYOUT.headerHeight)

    let x = PDF_LAYOUT.margin
    for (const header of TABLE_HEADERS) {
      const width = COLUMN_WIDTHS[header.key as keyof typeof COLUMN_WIDTHS]
      doc
        .fontSize(PDF_FONT_SIZES.tableHeader)
        .fillColor(PDF_COLORS.primary)
        .text(header.label, x + 2, y + 6, { width: width - 4, align: header.align })
      x += width
    }

    return y + PDF_LAYOUT.headerHeight
  }

  private drawTableRow(
    doc: PDFDoc,
    client: BadDebtClientItem,
    clientText: string,
    rowNum: number,
    y: number,
    rowHeight: number
  ): number {
    const centerY = y + (rowHeight - 8) / 2

    // Alternate row background
    if (rowNum % 2 === 0) {
      doc.fillColor(PDF_COLORS.rowAlt).rect(PDF_LAYOUT.margin, y, TOTAL_TABLE_WIDTH, rowHeight).fill()
    }

    let x = PDF_LAYOUT.margin

    // Row number
    drawCell(doc, rowNum.toString(), x, centerY, COLUMN_WIDTHS.num, PDF_COLORS.textMuted, PDF_FONT_SIZES.tableCell, 'center')
    x += COLUMN_WIDTHS.num

    // Client (multi-line)
    drawMultiLineCell(doc, clientText, x, y, COLUMN_WIDTHS.client, PDF_COLORS.black, PDF_FONT_SIZES.tableCell)
    x += COLUMN_WIDTHS.client

    // Amounts
    drawCell(doc, formatCurrency(client.amountRequested), x, centerY, COLUMN_WIDTHS.requested, PDF_COLORS.black, PDF_FONT_SIZES.tableCell, 'right')
    x += COLUMN_WIDTHS.requested

    drawCell(doc, formatCurrency(client.totalPaid), x, centerY, COLUMN_WIDTHS.paid, PDF_COLORS.black, PDF_FONT_SIZES.tableCell, 'right')
    x += COLUMN_WIDTHS.paid

    drawCell(doc, formatCurrency(client.pendingDebt), x, centerY, COLUMN_WIDTHS.pending, PDF_COLORS.destructive, PDF_FONT_SIZES.tableCell, 'right')
    x += COLUMN_WIDTHS.pending

    // Location & Leader
    drawCell(doc, client.locationName || '-', x, centerY, COLUMN_WIDTHS.location, PDF_COLORS.black, PDF_FONT_SIZES.tableCell)
    x += COLUMN_WIDTHS.location

    drawCell(doc, client.leadName || '-', x, centerY, COLUMN_WIDTHS.leader, PDF_COLORS.black, PDF_FONT_SIZES.tableCell)
    x += COLUMN_WIDTHS.leader

    // Last payment date
    const lastPayment = client.lastPaymentDate
      ? formatShortDate(new Date(client.lastPaymentDate))
      : '-'
    drawCell(doc, lastPayment, x, centerY, COLUMN_WIDTHS.lastPayment, PDF_COLORS.black, PDF_FONT_SIZES.tableCell)

    return y + rowHeight
  }

  private getClientText(client: BadDebtClientItem): string {
    return client.clientPhone
      ? `${client.clientName}\n${client.clientPhone}`
      : client.clientName
  }
}
