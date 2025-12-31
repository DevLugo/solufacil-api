import PDFDocument from 'pdfkit'
import type { PrismaClient } from '@solufacil/database'
import { LeaderService } from './LeaderService'
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
} from './pdf/pdfUtils'

interface LeaderBirthdayPDFParams {
  routeId?: string
  routeName?: string
}

interface LeaderBirthday {
  id: string
  fullName: string
  birthDate: Date | null
  phone: string | null
  locationName: string
  routeId: string
  routeName: string
  daysUntilBirthday: number
}

// Column configuration
const COLUMN_WIDTHS = {
  num: 25,
  name: 120,
  birthday: 70,
  age: 35,
  phone: 80,
  location: 90,
  route: 95,
} as const

const TABLE_HEADERS = [
  { key: 'num', label: '#', align: 'center' as const },
  { key: 'name', label: 'NOMBRE', align: 'left' as const },
  { key: 'birthday', label: 'CUMPLEAÑOS', align: 'center' as const },
  { key: 'age', label: 'EDAD', align: 'center' as const },
  { key: 'phone', label: 'TELÉFONO', align: 'left' as const },
  { key: 'location', label: 'LOCALIDAD', align: 'left' as const },
  { key: 'route', label: 'RUTA', align: 'left' as const },
]

const TOTAL_TABLE_WIDTH = Object.values(COLUMN_WIDTHS).reduce((a, b) => a + b, 0)

export class LeaderBirthdayPDFService {
  private leaderService: LeaderService

  constructor(private prisma: PrismaClient) {
    this.leaderService = new LeaderService(prisma)
  }

  async generatePDF(params: LeaderBirthdayPDFParams): Promise<Buffer> {
    const { routeId, routeName } = params

    const leaders = await this.leaderService.getLeaderBirthdays(routeId || undefined)

    return this.createPDF({
      leaders: leaders as LeaderBirthday[],
      totalLeaders: leaders.length,
      routeName,
      generatedAt: new Date(),
    })
  }

  private formatBirthday(birthDate: Date | null): string {
    if (!birthDate) return 'Sin fecha'
    const date = new Date(birthDate)
    const localDate = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    return localDate.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
  }

  private getAge(birthDate: Date | null): string {
    if (!birthDate) return '-'
    const today = new Date()
    const birth = new Date(birthDate)
    let age = today.getFullYear() - birth.getUTCFullYear()
    const m = today.getMonth() - birth.getUTCMonth()
    if (m < 0 || (m === 0 && today.getDate() < birth.getUTCDate())) {
      age--
    }
    return age.toString()
  }

  private createPDF(data: {
    leaders: LeaderBirthday[]
    totalLeaders: number
    routeName?: string
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
        this.drawTotalLeaders(doc, data.totalLeaders, 100)

        const pageNumber = this.drawTable(doc, data.leaders, 150)
        addPageNumber(doc, pageNumber, PDF_COLORS.textMuted)

        doc.end()
      } catch (error) {
        reject(error)
      }
    })
  }

  private drawHeader(doc: PDFDoc, data: { routeName?: string; generatedAt: Date }): void {
    drawLogo(doc, PDF_LAYOUT.margin, 25)

    doc
      .fontSize(PDF_FONT_SIZES.title)
      .fillColor(PDF_COLORS.primary)
      .text('Cumpleaños de Líderes', 0, 30, { align: 'center' })

    doc
      .fontSize(PDF_FONT_SIZES.small)
      .fillColor(PDF_COLORS.textMuted)
      .text(`Generado el ${formatLongDate(data.generatedAt)}`, 0, 50, { align: 'center' })

    const filterText = data.routeName ? `Ruta: ${data.routeName}` : 'Todas las rutas'
    doc.text(filterText, 0, 65, { align: 'center' })
  }

  private drawTotalLeaders(doc: PDFDoc, total: number, y: number): void {
    const boxWidth = 120
    const boxHeight = 35
    const x = PDF_LAYOUT.margin + (doc.page.width - PDF_LAYOUT.margin * 2 - boxWidth) / 2

    doc.fillColor(PDF_COLORS.headerBg).rect(x, y, boxWidth, boxHeight).fill()
    doc.fillColor(PDF_COLORS.primary).rect(x, y, 4, boxHeight).fill()

    doc
      .fontSize(PDF_FONT_SIZES.small)
      .fillColor(PDF_COLORS.textMuted)
      .text('Total Líderes', x + 10, y + 8, { width: boxWidth - 15, align: 'center' })

    doc
      .fontSize(PDF_FONT_SIZES.title)
      .fillColor(PDF_COLORS.primary)
      .text(total.toString(), x + 10, y + 18, { width: boxWidth - 15, align: 'center' })
  }

  private drawTable(doc: PDFDoc, leaders: LeaderBirthday[], startY: number): number {
    let currentY = this.drawTableHeader(doc, startY)
    let pageNumber = 1
    const pageHeight = doc.page.height - PDF_LAYOUT.footerMargin

    for (let i = 0; i < leaders.length; i++) {
      const leader = leaders[i]
      const rowHeight = this.calculateLeaderRowHeight(doc, leader)

      if (currentY + rowHeight > pageHeight) {
        addPageNumber(doc, pageNumber, PDF_COLORS.textMuted)
        doc.addPage()
        pageNumber++
        currentY = this.drawTableHeader(doc, PDF_LAYOUT.margin)
      }

      currentY = this.drawTableRow(doc, leader, i + 1, currentY, rowHeight)
    }

    return pageNumber
  }

  private calculateLeaderRowHeight(doc: PDFDoc, leader: LeaderBirthday): number {
    return calculateRowHeight(
      doc,
      [
        { text: leader.fullName, width: COLUMN_WIDTHS.name - 4 },
        { text: leader.locationName, width: COLUMN_WIDTHS.location - 4 },
        { text: leader.routeName, width: COLUMN_WIDTHS.route - 4 },
      ],
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
    leader: LeaderBirthday,
    rowNum: number,
    y: number,
    rowHeight: number
  ): number {
    const centerY = y + (rowHeight - 8) / 2
    const isUpcoming = leader.daysUntilBirthday >= 0 && leader.daysUntilBirthday <= 7

    // Row background for upcoming birthdays
    if (isUpcoming) {
      doc.fillColor('#f0fdf4').rect(PDF_LAYOUT.margin, y, TOTAL_TABLE_WIDTH, rowHeight).fill()
    }

    let x = PDF_LAYOUT.margin

    // Row number
    drawCell(doc, rowNum.toString(), x, centerY, COLUMN_WIDTHS.num, PDF_COLORS.textMuted, PDF_FONT_SIZES.tableCell, 'center')
    x += COLUMN_WIDTHS.num

    // Name (multi-line)
    drawMultiLineCell(doc, leader.fullName, x, y, COLUMN_WIDTHS.name, PDF_COLORS.black, PDF_FONT_SIZES.tableCell)
    x += COLUMN_WIDTHS.name

    // Birthday
    const birthdayColor = leader.birthDate ? PDF_COLORS.black : PDF_COLORS.textMuted
    drawCell(doc, this.formatBirthday(leader.birthDate), x, centerY, COLUMN_WIDTHS.birthday, birthdayColor, PDF_FONT_SIZES.tableCell, 'center')
    x += COLUMN_WIDTHS.birthday

    // Age
    drawCell(doc, this.getAge(leader.birthDate), x, centerY, COLUMN_WIDTHS.age, PDF_COLORS.black, PDF_FONT_SIZES.tableCell, 'center')
    x += COLUMN_WIDTHS.age

    // Phone
    const phoneColor = leader.phone ? PDF_COLORS.black : PDF_COLORS.textMuted
    drawCell(doc, leader.phone || '-', x, centerY, COLUMN_WIDTHS.phone, phoneColor, PDF_FONT_SIZES.tableCell)
    x += COLUMN_WIDTHS.phone

    // Location
    drawCell(doc, leader.locationName, x, centerY, COLUMN_WIDTHS.location, PDF_COLORS.black, PDF_FONT_SIZES.tableCell)
    x += COLUMN_WIDTHS.location

    // Route
    drawCell(doc, leader.routeName, x, centerY, COLUMN_WIDTHS.route, PDF_COLORS.textMuted, PDF_FONT_SIZES.tableCell)

    return y + rowHeight
  }
}
