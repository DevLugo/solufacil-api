import PDFDocument from 'pdfkit'
import path from 'path'

// Type alias for PDFKit document
export type PDFDoc = InstanceType<typeof PDFDocument>

// Common colors used across PDF reports
export const PDF_COLORS = {
  primary: '#F26522', // SoluFácil orange
  headerBg: '#FEF3E8', // Light orange background
  textMuted: '#71717a',
  destructive: '#ef4444',
  success: '#16a34a',
  warning: '#ca8a04',
  black: '#000000',
  rowAlt: '#fafafa',
  border: '#e5e5e5',
}

// Common font sizes
export const PDF_FONT_SIZES = {
  title: 16,
  subtitle: 12,
  normal: 10,
  small: 8,
  tableHeader: 7,
  tableCell: 6,
}

// Common layout constants
export const PDF_LAYOUT = {
  margin: 40,
  footerMargin: 50,
  headerHeight: 20,
  minRowHeight: 18,
}

/**
 * Calculate row height that fits all content
 */
export function calculateRowHeight(
  doc: PDFDoc,
  texts: { text: string; width: number }[],
  fontSize: number,
  minHeight: number = PDF_LAYOUT.minRowHeight,
  padding: number = 6
): number {
  doc.fontSize(fontSize)

  let maxHeight = 0
  for (const { text, width } of texts) {
    const height = doc.heightOfString(text, { width })
    if (height > maxHeight) {
      maxHeight = height
    }
  }

  return Math.max(minHeight, maxHeight + padding)
}

/**
 * Draw a cell with text (single line, no page break)
 */
export function drawCell(
  doc: PDFDoc,
  text: string,
  x: number,
  y: number,
  width: number,
  color: string,
  fontSize: number,
  align: 'left' | 'center' | 'right' = 'left'
): void {
  doc
    .fontSize(fontSize)
    .fillColor(color)
    .text(text, x + 2, y, { width: width - 4, align, lineBreak: false })
}

/**
 * Draw multi-line text in a cell (for name/description columns)
 * Saves and restores doc.y to prevent page breaks
 */
export function drawMultiLineCell(
  doc: PDFDoc,
  text: string,
  x: number,
  y: number,
  width: number,
  color: string,
  fontSize: number
): void {
  const savedY = doc.y
  doc
    .fontSize(fontSize)
    .fillColor(color)
    .text(text, x + 2, y + 3, { width: width - 4, lineGap: 1 })
  doc.y = savedY
}

/**
 * Draw page number without causing page breaks
 */
export function addPageNumber(doc: PDFDoc, pageNum: number, color: string): void {
  const savedY = doc.y
  doc
    .fontSize(PDF_FONT_SIZES.small)
    .fillColor(color)
    .text(`Página ${pageNum}`, doc.page.width - 100, doc.page.height - 30, { lineBreak: false })
  doc.y = savedY
}

/**
 * Draw table header background with borders
 */
export function drawTableHeaderBackground(
  doc: PDFDoc,
  y: number,
  width: number,
  height: number
): void {
  // Background
  doc
    .fillColor(PDF_COLORS.headerBg)
    .rect(PDF_LAYOUT.margin, y, width, height)
    .fill()

  // Top border
  doc
    .strokeColor(PDF_COLORS.primary)
    .lineWidth(2)
    .moveTo(PDF_LAYOUT.margin, y)
    .lineTo(PDF_LAYOUT.margin + width, y)
    .stroke()

  // Bottom border
  doc
    .strokeColor(PDF_COLORS.primary)
    .lineWidth(0.5)
    .moveTo(PDF_LAYOUT.margin, y + height)
    .lineTo(PDF_LAYOUT.margin + width, y + height)
    .stroke()
}

/**
 * Format currency for PDF display
 */
export function formatCurrency(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num)
}

/**
 * Format long date (e.g., "31 de diciembre de 2024")
 */
export function formatLongDate(date: Date): string {
  return date.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Format short date (e.g., "31 dic 24")
 */
export function formatShortDate(date: Date): string {
  return date.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  })
}

/**
 * Get logo path
 */
export function getLogoPath(): string {
  return path.join(process.cwd(), '../web/public/solufacil.png')
}

/**
 * Draw logo safely (catches error if not found)
 */
export function drawLogo(doc: PDFDoc, x: number, y: number, width: number = 80): void {
  try {
    doc.image(getLogoPath(), x, y, { width })
  } catch {
    // Logo not found, skip
  }
}
