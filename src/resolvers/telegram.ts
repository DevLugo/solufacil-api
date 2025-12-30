import { GraphQLError } from 'graphql'
import type { GraphQLContext } from '../context'
import { UserRole } from '@solufacil/database'
import { TelegramService } from '../services/TelegramService'
import { requireAnyRole } from '../middleware/auth'
import PDFDocument from 'pdfkit'
import path from 'path'

export interface TelegramUserFiltersInput {
  isActive?: boolean
  isLinkedToUser?: boolean
  isInRecipientsList?: boolean
  searchTerm?: string
}

export interface ReportScheduleInput {
  days: number[]
  hour: string
  timezone?: string
}

export interface CreateReportConfigInput {
  name: string
  reportType: 'NOTIFICACION_TIEMPO_REAL' | 'CREDITOS_CON_ERRORES'
  schedule: ReportScheduleInput
  routeIds: string[]
  recipientIds: string[]
  isActive?: boolean
}

export interface UpdateReportConfigInput {
  name?: string
  schedule?: ReportScheduleInput
  routeIds?: string[]
  recipientIds?: string[]
  isActive?: boolean
}

export interface SendDocumentNotificationInput {
  documentId: string
  recipientChatIds: string[]
  customMessage?: string
  includePhoto?: boolean
}

export interface LinkTelegramToUserInput {
  telegramUserId: string
  platformUserId: string
}

export interface UpdateTelegramUserInput {
  isActive?: boolean
  isInRecipientsList?: boolean
  notes?: string
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  INE: 'ID Card (INE)',
  DOMICILIO: 'Proof of Address',
  PAGARE: 'Promissory Note',
  OTRO: 'Other',
}

export const telegramResolvers = {
  Query: {
    telegramUsers: async (
      _parent: unknown,
      args: {
        filters?: TelegramUserFiltersInput
        limit?: number
        offset?: number
      },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      const where: any = {}

      if (args.filters?.isActive !== undefined) {
        where.isActive = args.filters.isActive
      }

      if (args.filters?.isLinkedToUser !== undefined) {
        where.platformUser = args.filters.isLinkedToUser ? { not: null } : null
      }

      if (args.filters?.isInRecipientsList !== undefined) {
        where.isInRecipientsList = args.filters.isInRecipientsList
      }

      if (args.filters?.searchTerm) {
        where.OR = [
          { name: { contains: args.filters.searchTerm, mode: 'insensitive' } },
          { username: { contains: args.filters.searchTerm, mode: 'insensitive' } },
          { chatId: { contains: args.filters.searchTerm } },
        ]
      }

      return context.prisma.telegramUser.findMany({
        where,
        include: {
          platformUserRelation: true,
          reportConfigs: true,
        },
        orderBy: { registeredAt: 'desc' },
        take: args.limit || 50,
        skip: args.offset || 0,
      })
    },

    telegramUser: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      return context.prisma.telegramUser.findUnique({
        where: { id: args.id },
        include: {
          platformUserRelation: true,
          reportConfigs: {
            include: {
              routes: true,
            },
          },
        },
      })
    },

    telegramUserStats: async (
      _parent: unknown,
      _args: unknown,
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      const [totalUsers, activeUsers, inactiveUsers, linkedToPlataform, inRecipientsList] =
        await Promise.all([
          context.prisma.telegramUser.count(),
          context.prisma.telegramUser.count({ where: { isActive: true } }),
          context.prisma.telegramUser.count({ where: { isActive: false } }),
          context.prisma.telegramUser.count({ where: { platformUser: { not: null } } }),
          context.prisma.telegramUser.count({ where: { isInRecipientsList: true } }),
        ])

      return {
        totalUsers,
        activeUsers,
        inactiveUsers,
        linkedToPlataform,
        inRecipientsList,
      }
    },

    telegramUserByChatId: async (
      _parent: unknown,
      args: { chatId: string },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      return context.prisma.telegramUser.findUnique({
        where: { chatId: args.chatId },
        include: {
          platformUserRelation: true,
        },
      })
    },

    reportConfigs: async (
      _parent: unknown,
      args: { isActive?: boolean },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      const where: any = {}
      if (args.isActive !== undefined) {
        where.isActive = args.isActive
      }

      return context.prisma.reportConfig.findMany({
        where,
        include: {
          routes: true,
          telegramRecipients: true,
          executionLogs: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
        orderBy: { createdAt: 'desc' },
      })
    },

    reportConfig: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      return context.prisma.reportConfig.findUnique({
        where: { id: args.id },
        include: {
          routes: true,
          telegramRecipients: true,
          executionLogs: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
        },
      })
    },

    reportExecutionLogs: async (
      _parent: unknown,
      args: {
        reportConfigId?: string
        status?: string
        fromDate?: Date
        toDate?: Date
        limit?: number
        offset?: number
      },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      const where: any = {}

      if (args.reportConfigId) {
        where.reportConfig = args.reportConfigId
      }

      if (args.status) {
        where.status = args.status
      }

      if (args.fromDate || args.toDate) {
        where.startTime = {}
        if (args.fromDate) where.startTime.gte = args.fromDate
        if (args.toDate) where.startTime.lte = args.toDate
      }

      return context.prisma.reportExecutionLog.findMany({
        where,
        include: {
          reportConfigRelation: true,
        },
        orderBy: { createdAt: 'desc' },
        take: args.limit || 50,
        skip: args.offset || 0,
      })
    },

    documentNotificationLogs: async (
      _parent: unknown,
      args: {
        routeId?: string
        status?: string
        issueType?: string
        fromDate?: Date
        toDate?: Date
        limit?: number
        offset?: number
      },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      const where: any = {}

      if (args.routeId) {
        where.routeId = args.routeId
      }

      if (args.status) {
        where.status = args.status
      }

      if (args.issueType) {
        where.issueType = args.issueType
      }

      if (args.fromDate || args.toDate) {
        where.createdAt = {}
        if (args.fromDate) where.createdAt.gte = args.fromDate
        if (args.toDate) where.createdAt.lte = args.toDate
      }

      return context.prisma.documentNotificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: args.limit || 50,
        skip: args.offset || 0,
      })
    },

    documentsWithNotificationStatus: async (
      _parent: unknown,
      args: {
        routeId?: string
        hasErrors?: boolean
        hasMissing?: boolean
        limit?: number
        offset?: number
      },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      const where: any = {
        OR: [],
      }

      if (args.hasErrors) {
        where.OR.push({ isError: true })
      }

      if (args.hasMissing) {
        where.OR.push({ isMissing: true })
      }

      if (where.OR.length === 0) {
        where.OR = [{ isError: true }, { isMissing: true }]
      }

      // If route filter, we need to get via loan
      if (args.routeId) {
        where.loanRelation = {
          snapshotRouteId: args.routeId,
        }
      }

      const documents = await context.prisma.documentPhoto.findMany({
        where,
        include: {
          personalDataRelation: true,
          loanRelation: true,
        },
        orderBy: { createdAt: 'desc' },
        take: args.limit || 50,
        skip: args.offset || 0,
      })

      // Get notification status for each document
      const results = await Promise.all(
        documents.map(async (doc) => {
          const lastNotification = await context.prisma.documentNotificationLog.findFirst({
            where: { documentId: doc.id },
            orderBy: { createdAt: 'desc' },
          })

          return {
            document: doc,
            notificationSent: !!lastNotification,
            lastNotification,
          }
        })
      )

      return results
    },
  },

  Mutation: {
    activateTelegramUser: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      return context.prisma.telegramUser.update({
        where: { id: args.id },
        data: {
          isActive: true,
          lastActivity: new Date(),
        },
        include: {
          platformUserRelation: true,
        },
      })
    },

    deactivateTelegramUser: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      return context.prisma.telegramUser.update({
        where: { id: args.id },
        data: {
          isActive: false,
          lastActivity: new Date(),
        },
        include: {
          platformUserRelation: true,
        },
      })
    },

    updateTelegramUser: async (
      _parent: unknown,
      args: { id: string; input: UpdateTelegramUserInput },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      const data: any = {}
      if (args.input.isActive !== undefined) data.isActive = args.input.isActive
      if (args.input.isInRecipientsList !== undefined)
        data.isInRecipientsList = args.input.isInRecipientsList
      if (args.input.notes !== undefined) data.notes = args.input.notes

      return context.prisma.telegramUser.update({
        where: { id: args.id },
        data,
        include: {
          platformUserRelation: true,
        },
      })
    },

    linkTelegramToUser: async (
      _parent: unknown,
      args: { input: LinkTelegramToUserInput },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      // Check if user already has a telegram linked
      const existingLink = await context.prisma.telegramUser.findFirst({
        where: { platformUser: args.input.platformUserId },
      })

      if (existingLink) {
        throw new GraphQLError('This platform user already has a linked Telegram account', {
          extensions: { code: 'USER_ALREADY_LINKED' },
        })
      }

      return context.prisma.telegramUser.update({
        where: { id: args.input.telegramUserId },
        data: {
          platformUser: args.input.platformUserId,
          lastActivity: new Date(),
        },
        include: {
          platformUserRelation: true,
        },
      })
    },

    unlinkTelegramFromUser: async (
      _parent: unknown,
      args: { telegramUserId: string },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      return context.prisma.telegramUser.update({
        where: { id: args.telegramUserId },
        data: {
          platformUser: null,
          lastActivity: new Date(),
        },
        include: {
          platformUserRelation: true,
        },
      })
    },

    deleteTelegramUser: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      await context.prisma.telegramUser.delete({
        where: { id: args.id },
      })

      return true
    },

    createReportConfig: async (
      _parent: unknown,
      args: { input: CreateReportConfigInput },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      return context.prisma.reportConfig.create({
        data: {
          name: args.input.name,
          reportType: args.input.reportType,
          schedule: {
            days: args.input.schedule.days,
            hour: args.input.schedule.hour,
            timezone: args.input.schedule.timezone || 'America/Mexico_City',
          },
          isActive: args.input.isActive ?? true,
          routes: {
            connect: args.input.routeIds.map((id) => ({ id })),
          },
          telegramRecipients: {
            connect: args.input.recipientIds.map((id) => ({ id })),
          },
        },
        include: {
          routes: true,
          telegramRecipients: true,
        },
      })
    },

    updateReportConfig: async (
      _parent: unknown,
      args: { id: string; input: UpdateReportConfigInput },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      const data: any = {}

      if (args.input.name !== undefined) data.name = args.input.name
      if (args.input.isActive !== undefined) data.isActive = args.input.isActive
      if (args.input.schedule !== undefined) {
        data.schedule = {
          days: args.input.schedule.days,
          hour: args.input.schedule.hour,
          timezone: args.input.schedule.timezone || 'America/Mexico_City',
        }
      }

      if (args.input.routeIds !== undefined) {
        data.routes = {
          set: args.input.routeIds.map((id) => ({ id })),
        }
      }

      if (args.input.recipientIds !== undefined) {
        data.telegramRecipients = {
          set: args.input.recipientIds.map((id) => ({ id })),
        }
      }

      return context.prisma.reportConfig.update({
        where: { id: args.id },
        data,
        include: {
          routes: true,
          telegramRecipients: true,
        },
      })
    },

    deleteReportConfig: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      // Delete execution logs first
      await context.prisma.reportExecutionLog.deleteMany({
        where: { reportConfig: args.id },
      })

      await context.prisma.reportConfig.delete({
        where: { id: args.id },
      })

      return true
    },

    toggleReportConfig: async (
      _parent: unknown,
      args: { id: string },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      const config = await context.prisma.reportConfig.findUnique({
        where: { id: args.id },
      })

      if (!config) {
        throw new GraphQLError('Report configuration not found', {
          extensions: { code: 'NOT_FOUND' },
        })
      }

      return context.prisma.reportConfig.update({
        where: { id: args.id },
        data: { isActive: !config.isActive },
        include: {
          routes: true,
          telegramRecipients: true,
        },
      })
    },

    executeReportManually: async (
      _parent: unknown,
      args: { reportConfigId: string },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      const config = await context.prisma.reportConfig.findUnique({
        where: { id: args.reportConfigId },
        include: {
          routes: true,
          telegramRecipients: {
            where: { isActive: true },
          },
        },
      })

      if (!config) {
        throw new GraphQLError('Report configuration not found', {
          extensions: { code: 'NOT_FOUND' },
        })
      }

      if (config.telegramRecipients.length === 0) {
        return {
          success: false,
          message: 'No active recipients configured',
          recipientsNotified: 0,
          errors: ['No active recipients'],
        }
      }

      const startTime = new Date()
      const telegramService = new TelegramService()
      const errors: string[] = []
      let successCount = 0

      // Build report message based on type
      // Note: reportType may be stored in lowercase in the database
      const reportTypeLower = config.reportType.toLowerCase()
      const routeNames = config.routes.map((r) => r.name).join(', ') || 'Todas'
      const generatedDate = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })

      if (reportTypeLower === 'notificacion_tiempo_real') {
        // Send simple message for real-time notifications
        const message = `<b>📊 Reporte de Notificaciones</b>\n\n` +
          `<b>Rutas:</b> ${routeNames}\n` +
          `<b>Generado:</b> ${generatedDate}`

        for (const recipient of config.telegramRecipients) {
          try {
            await telegramService.sendMessage(recipient.chatId, message)
            successCount++
            await context.prisma.telegramUser.update({
              where: { id: recipient.id },
              data: { reportsReceived: { increment: 1 }, lastActivity: new Date() },
            })
          } catch (error) {
            errors.push(`Error enviando a ${recipient.name}: ${error instanceof Error ? error.message : 'Error desconocido'}`)
          }
        }
      } else if (reportTypeLower === 'creditos_con_errores') {
        // Generate PDF with documents that have errors
        const routeIds = config.routes.map((r) => r.id)

        // Build where clause - include documents with errors/missing
        // If routes are configured, filter by those routes OR include docs with NULL snapshotRouteId
        let whereClause: any = {
          OR: [{ isError: true }, { isMissing: true }],
        }

        if (routeIds.length > 0) {
          // Include documents where:
          // 1. The loan's snapshotRouteId is in the configured routes, OR
          // 2. The loan's snapshotRouteId is NULL (to not miss any documents)
          whereClause = {
            AND: [
              { OR: [{ isError: true }, { isMissing: true }] },
              {
                OR: [
                  { loanRelation: { snapshotRouteId: { in: routeIds } } },
                  { loanRelation: { snapshotRouteId: null } },
                ],
              },
            ],
          }
        }

        // Fetch documents with errors including loan and client info
        const docsWithErrors = await context.prisma.documentPhoto.findMany({
          where: whereClause,
          include: {
            loanRelation: {
              include: {
                borrowerRelation: {
                  include: {
                    personalDataRelation: true,
                  },
                },
                snapshotRoute: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        })

        if (docsWithErrors.length === 0) {
          // No errors, send message only
          const message = `<b>✅ Reporte de Créditos con Errores</b>\n\n` +
            `No hay documentos con errores o faltantes.\n\n` +
            `<b>Rutas:</b> ${routeNames}\n` +
            `<b>Generado:</b> ${generatedDate}`

          for (const recipient of config.telegramRecipients) {
            try {
              await telegramService.sendMessage(recipient.chatId, message)
              successCount++
              await context.prisma.telegramUser.update({
                where: { id: recipient.id },
                data: { reportsReceived: { increment: 1 }, lastActivity: new Date() },
              })
            } catch (error) {
              errors.push(`Error enviando a ${recipient.name}: ${error instanceof Error ? error.message : 'Error desconocido'}`)
            }
          }
        } else {
          // Helper functions - Use Mexico timezone to avoid UTC date shift issues
          const getMexicoDate = (d: Date): Date => {
            // Convert to Mexico timezone string and parse back
            const mexicoStr = d.toLocaleString('en-US', { timeZone: 'America/Mexico_City' })
            return new Date(mexicoStr)
          }

          const getIsoMonday = (d: Date): Date => {
            const mexicoDate = getMexicoDate(d)
            // getDay() returns 0 for Sunday, 1 for Monday, etc.
            // We want Monday as start of week
            const dayOfWeek = mexicoDate.getDay()
            const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1 // Sunday = go back 6 days, otherwise go back (day - 1)
            const monday = new Date(mexicoDate)
            monday.setDate(mexicoDate.getDate() - daysToSubtract)
            monday.setHours(0, 0, 0, 0)
            return monday
          }

          const formatWeekRange = (monday: Date): string => {
            const sunday = new Date(monday)
            sunday.setDate(monday.getDate() + 6)
            const formatDay = (d: Date) => d.toLocaleDateString('es-MX', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: 'America/Mexico_City'
            })
            return `${formatDay(monday)} - ${formatDay(sunday)}`
          }

          const getWeekKey = (date: Date): string => {
            const monday = getIsoMonday(date)
            // Use local date format to avoid UTC conversion issues
            const year = monday.getFullYear()
            const month = String(monday.getMonth() + 1).padStart(2, '0')
            const day = String(monday.getDate()).padStart(2, '0')
            return `${year}-${month}-${day}`
          }

          // Group documents by week
          const docsByWeek = new Map<string, typeof docsWithErrors>()
          for (const doc of docsWithErrors) {
            const weekKey = getWeekKey(doc.createdAt)
            if (!docsByWeek.has(weekKey)) {
              docsByWeek.set(weekKey, [])
            }
            docsByWeek.get(weekKey)!.push(doc)
          }

          // Sort weeks descending (most recent first)
          const sortedWeeks = Array.from(docsByWeek.keys()).sort((a, b) => b.localeCompare(a))

          // Generate PDF
          const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = []
            const doc = new PDFDocument({
              size: 'LETTER',
              margin: 30,
              bufferPages: true,
            })

            doc.on('data', (chunk) => chunks.push(chunk))
            doc.on('end', () => resolve(Buffer.concat(chunks)))
            doc.on('error', reject)

            const pageWidth = doc.page.width - 60
            const marginLeft = 30

            // Brand colors
            const primaryOrange = '#F26522'
            const lightOrange = '#FFF5F0'
            const darkGray = '#333333'

            // Column configuration
            const colWidths = [150, 80, 100, 55, pageWidth - 385]
            const headers = ['CLIENTE', 'RUTA', 'TIPO', 'ESTADO', 'DESCRIPCIÓN']
            const headerHeight = 20
            const rowHeight = 14

            // Draw table headers function
            const drawTableHeaders = (y: number): number => {
              // Header background with orange accent
              doc.rect(marginLeft, y, pageWidth, headerHeight).fillAndStroke(lightOrange, primaryOrange)
              doc.fillColor(darkGray).fontSize(7).font('Helvetica-Bold')

              let xPos = marginLeft
              headers.forEach((header, i) => {
                doc.text(header, xPos + 3, y + 6, { width: colWidths[i] - 6 })
                xPos += colWidths[i]
              })

              // Vertical lines
              doc.lineWidth(0.5)
              xPos = marginLeft
              colWidths.forEach((width) => {
                doc.moveTo(xPos, y).lineTo(xPos, y + headerHeight).stroke(primaryOrange)
                xPos += width
              })
              doc.moveTo(xPos, y).lineTo(xPos, y + headerHeight).stroke(primaryOrange)

              return y + headerHeight
            }

            // Draw data row function
            const drawDataRow = (data: string[], y: number, isAlt: boolean): number => {
              // Alternating row background
              if (isAlt) {
                doc.rect(marginLeft, y, pageWidth, rowHeight).fill('#fafafa')
              }

              // Row border
              doc.lineWidth(0.3).rect(marginLeft, y, pageWidth, rowHeight).stroke('#e0e0e0')

              doc.fillColor('#000000').fontSize(7).font('Helvetica')

              let xPos = marginLeft
              data.forEach((cell, i) => {
                doc.text(cell, xPos + 3, y + 3, { width: colWidths[i] - 6, lineBreak: false })
                xPos += colWidths[i]
              })

              // Vertical lines
              xPos = marginLeft
              colWidths.forEach((width) => {
                doc.moveTo(xPos, y).lineTo(xPos, y + rowHeight).stroke('#e0e0e0')
                xPos += width
              })
              doc.moveTo(xPos, y).lineTo(xPos, y + rowHeight).stroke('#e0e0e0')

              return y + rowHeight
            }

            // === HEADER ===
            const headerY = 25

            // Logo on the right
            try {
              const logoPath = path.join(process.cwd(), '../web/public/solufacil.png')
              doc.image(logoPath, doc.page.width - 130, 10, { width: 100 })
            } catch (err) {
              console.warn('Logo not found, skipping')
            }

            // Title on the left
            doc.fontSize(14).font('Helvetica-Bold').fillColor(primaryOrange)
              .text('Reporte de Créditos con Errores', marginLeft, headerY)

            // Subtitle
            doc.fontSize(10).font('Helvetica').fillColor(darkGray)
              .text(`Generado: ${generatedDate}`, marginLeft, headerY + 20)

            // Details row
            const detailsY = headerY + 45
            doc.fontSize(8).fillColor('gray').text('Rutas:', marginLeft, detailsY)
            doc.fillColor('black').text(routeNames, marginLeft + 40, detailsY)

            // Stats
            const errorCount = docsWithErrors.filter(d => d.isError).length
            const missingCount = docsWithErrors.filter(d => d.isMissing).length
            const statsY = detailsY + 15
            doc.fontSize(8).fillColor('black')
            doc.text(`Total de documentos: ${docsWithErrors.length}`, marginLeft, statsY)
            doc.text(`Con error: ${errorCount}`, marginLeft + 150, statsY)
            doc.text(`Faltantes: ${missingCount}`, marginLeft + 280, statsY)
            doc.text(`Semanas: ${sortedWeeks.length}`, marginLeft + 400, statsY)

            // === DOCUMENTS BY WEEK ===
            let currentY = statsY + 25
            const pageHeight = doc.page.height - 50

            for (const weekKey of sortedWeeks) {
              const weekDocs = docsByWeek.get(weekKey)!
              const monday = new Date(weekKey)
              const weekRange = formatWeekRange(monday)

              // Check if we need a new page for week header
              if (currentY + 60 > pageHeight) {
                doc.addPage()
                currentY = 30
              }

              // Week section header (orange bar)
              doc.rect(marginLeft, currentY, pageWidth, 18).fillAndStroke(primaryOrange, primaryOrange)
              doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
              doc.text(`Semana: ${weekRange}`, marginLeft + 8, currentY + 5)
              doc.text(`(${weekDocs.length} documentos)`, marginLeft + pageWidth - 110, currentY + 5)
              doc.fillColor('#000000')
              currentY += 20

              // Table headers
              currentY = drawTableHeaders(currentY)

              // Data rows
              let rowIndex = 0
              for (const docItem of weekDocs) {
                // Check if we need a new page
                if (currentY + rowHeight > pageHeight) {
                  doc.addPage()
                  currentY = 30

                  // Repeat week header on new page
                  doc.rect(marginLeft, currentY, pageWidth, 16).fillAndStroke(primaryOrange, primaryOrange)
                  doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
                  doc.text(`${weekRange} (continuación)`, marginLeft + 8, currentY + 4)
                  doc.fillColor('#000000')
                  currentY += 18
                  currentY = drawTableHeaders(currentY)
                }

                const clientName = docItem.loanRelation?.borrowerRelation?.personalDataRelation?.fullName || 'Sin cliente'
                const routeName = docItem.loanRelation?.snapshotRoute?.name || docItem.loanRelation?.snapshotRouteName || 'Sin ruta'
                const docType = docItem.documentType || 'N/A'
                const status = docItem.isError ? 'Error' : 'Faltante'
                const description = docItem.errorDescription || '-'

                const rowData = [
                  clientName.length > 30 ? clientName.substring(0, 27) + '...' : clientName,
                  routeName.length > 15 ? routeName.substring(0, 12) + '...' : routeName,
                  docType.length > 18 ? docType.substring(0, 15) + '...' : docType,
                  status,
                  description.length > 50 ? description.substring(0, 47) + '...' : description
                ]

                currentY = drawDataRow(rowData, currentY, rowIndex % 2 === 1)
                rowIndex++
              }

              currentY += 12 // Space between weeks
            }

            // Add page numbers to all pages
            const totalPages = doc.bufferedPageRange().count
            for (let i = 0; i < totalPages; i++) {
              doc.switchToPage(i)
              doc.fontSize(8).font('Helvetica').fillColor('#666666')
              doc.text(
                `Página ${i + 1} de ${totalPages}`,
                doc.page.width - 100,
                doc.page.height - 35,
                { align: 'right' }
              )
            }

            doc.end()
          })

          // Send PDF to all recipients
          const caption = `<b>📋 Reporte de Créditos con Errores</b>\n\n` +
            `<b>Total:</b> ${docsWithErrors.length} documentos con problemas\n` +
            `<b>Rutas:</b> ${routeNames}\n` +
            `<b>Generado:</b> ${generatedDate}`

          const filename = `creditos_con_errores_${new Date().toISOString().split('T')[0]}.pdf`

          for (const recipient of config.telegramRecipients) {
            try {
              await telegramService.sendDocument(recipient.chatId, pdfBuffer, {
                filename,
                caption,
                parseMode: 'HTML',
              })
              successCount++
              await context.prisma.telegramUser.update({
                where: { id: recipient.id },
                data: { reportsReceived: { increment: 1 }, lastActivity: new Date() },
              })
            } catch (error) {
              errors.push(`Error enviando a ${recipient.name}: ${error instanceof Error ? error.message : 'Error desconocido'}`)
            }
          }
        }
      }

      const endTime = new Date()

      // Log execution
      await context.prisma.reportExecutionLog.create({
        data: {
          reportConfig: args.reportConfigId,
          status: errors.length === 0 ? 'SUCCESS' : successCount > 0 ? 'PARTIAL' : 'FAILED',
          executionType: 'MANUAL',
          message: 'Report executed manually',
          errorDetails: errors.join('\n'),
          recipientsCount: config.telegramRecipients.length,
          successfulDeliveries: successCount,
          failedDeliveries: errors.length,
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      })

      return {
        success: errors.length === 0,
        message:
          errors.length === 0
            ? `Report sent to ${successCount} recipients`
            : `Sent to ${successCount} of ${config.telegramRecipients.length} recipients`,
        recipientsNotified: successCount,
        errors: errors.length > 0 ? errors : null,
      }
    },

    sendDocumentNotification: async (
      _parent: unknown,
      args: { input: SendDocumentNotificationInput },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      const document = await context.prisma.documentPhoto.findUnique({
        where: { id: args.input.documentId },
        include: {
          personalDataRelation: true,
          loanRelation: {
            include: {
              snapshotRoute: true,
            },
          },
        },
      })

      if (!document) {
        throw new GraphQLError('Document not found', {
          extensions: { code: 'NOT_FOUND' },
        })
      }

      const telegramService = new TelegramService()
      const issueType = document.isError ? 'ERROR' : 'MISSING'
      const personName = document.personalDataRelation?.fullName || 'Unknown'
      const routeName = document.loanRelation?.snapshotRouteName || 'No route'
      const documentTypeLabel = DOCUMENT_TYPE_LABELS[document.documentType] || document.documentType

      // Build message
      let message = args.input.customMessage || ''
      if (!message) {
        if (issueType === 'ERROR') {
          message = `<b>⚠️ Document Error</b>\n\n`
          message += `<b>Type:</b> ${documentTypeLabel}\n`
          message += `<b>Person:</b> ${personName}\n`
          message += `<b>Route:</b> ${routeName}\n`
          if (document.errorDescription) {
            message += `<b>Description:</b> ${document.errorDescription}\n`
          }
          message += `\nPlease review and correct this document.`
        } else {
          message = `<b>📄 Missing Document</b>\n\n`
          message += `<b>Type:</b> ${documentTypeLabel}\n`
          message += `<b>Person:</b> ${personName}\n`
          message += `<b>Route:</b> ${routeName}\n`
          message += `\nPlease upload the missing document.`
        }
      }

      const chatId = args.input.recipientChatIds[0]
      if (!chatId) {
        return {
          success: false,
          message: 'No recipient provided',
          notificationId: null,
          telegramResponse: null,
        }
      }

      try {
        let response
        if (args.input.includePhoto && document.photoUrl && issueType === 'ERROR') {
          // Send photo with caption
          response = await telegramService.sendPhoto(chatId, document.photoUrl, {
            caption: message,
            parseMode: 'HTML',
          })
        } else {
          // Send text only
          response = await telegramService.sendMessage(chatId, message)
        }

        // Log the notification
        const notificationLog = await context.prisma.documentNotificationLog.create({
          data: {
            documentId: document.id,
            documentType: document.documentType,
            personalDataId: document.personalData || '',
            personName,
            loanId: document.loan || '',
            routeId: document.loanRelation?.snapshotRouteId || '',
            routeName,
            issueType,
            description: document.errorDescription || '',
            messageContent: message,
            status: response.ok ? 'SENT' : 'FAILED',
            telegramChatId: chatId,
            telegramResponse: JSON.stringify(response),
            sentAt: response.ok ? new Date() : undefined,
          },
        })

        return {
          success: response.ok,
          message: response.ok ? 'Notification sent successfully' : 'Error sending notification',
          notificationId: notificationLog.id,
          telegramResponse: JSON.stringify(response),
        }
      } catch (error) {
        // Log failed notification
        await context.prisma.documentNotificationLog.create({
          data: {
            documentId: document.id,
            documentType: document.documentType,
            personalDataId: document.personalData || '',
            personName,
            loanId: document.loan || '',
            routeId: document.loanRelation?.snapshotRouteId || '',
            routeName,
            issueType,
            description: document.errorDescription || '',
            messageContent: message,
            status: 'FAILED',
            telegramChatId: chatId,
            telegramErrorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        })

        return {
          success: false,
          message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          notificationId: null,
          telegramResponse: null,
        }
      }
    },

    retryFailedNotification: async (
      _parent: unknown,
      args: { notificationId: string },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      const notification = await context.prisma.documentNotificationLog.findUnique({
        where: { id: args.notificationId },
      })

      if (!notification) {
        throw new GraphQLError('Notification not found', {
          extensions: { code: 'NOT_FOUND' },
        })
      }

      if (notification.status === 'SENT') {
        return {
          success: false,
          message: 'This notification was already sent successfully',
          notificationId: notification.id,
          telegramResponse: null,
        }
      }

      const telegramService = new TelegramService()

      try {
        const response = await telegramService.sendMessage(
          notification.telegramChatId,
          notification.messageContent
        )

        await context.prisma.documentNotificationLog.update({
          where: { id: args.notificationId },
          data: {
            status: response.ok ? 'SENT' : 'FAILED',
            telegramResponse: JSON.stringify(response),
            sentAt: response.ok ? new Date() : undefined,
            retryCount: { increment: 1 },
            lastRetryAt: new Date(),
          },
        })

        return {
          success: response.ok,
          message: response.ok ? 'Notification resent successfully' : 'Error resending notification',
          notificationId: notification.id,
          telegramResponse: JSON.stringify(response),
        }
      } catch (error) {
        await context.prisma.documentNotificationLog.update({
          where: { id: args.notificationId },
          data: {
            retryCount: { increment: 1 },
            lastRetryAt: new Date(),
            telegramErrorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        })

        return {
          success: false,
          message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          notificationId: notification.id,
          telegramResponse: null,
        }
      }
    },

    sendBulkDocumentNotifications: async (
      _parent: unknown,
      args: {
        documentIds: string[]
        recipientChatIds: string[]
        includePhoto?: boolean
      },
      context: GraphQLContext
    ) => {
      requireAnyRole(context, [UserRole.ADMIN])

      const results: Array<{
        success: boolean
        message: string
        notificationId: string | null
        telegramResponse: string | null
      }> = []

      for (const documentId of args.documentIds) {
        // Reuse the single notification logic
        const result = await telegramResolvers.Mutation.sendDocumentNotification(
          _parent,
          {
            input: {
              documentId,
              recipientChatIds: args.recipientChatIds,
              includePhoto: args.includePhoto,
            },
          },
          context
        )
        results.push(result)
      }

      return results
    },
  },

  // Type resolvers
  TelegramUser: {
    platformUser: async (parent: any, _args: unknown, context: GraphQLContext) => {
      if (parent.platformUserRelation) return parent.platformUserRelation
      if (!parent.platformUser) return null

      return context.prisma.user.findUnique({
        where: { id: parent.platformUser },
      })
    },

    reportConfigs: async (parent: any, _args: unknown, context: GraphQLContext) => {
      if (parent.reportConfigs) return parent.reportConfigs

      return context.prisma.reportConfig.findMany({
        where: {
          telegramRecipients: {
            some: { id: parent.id },
          },
        },
      })
    },
  },

  ReportConfig: {
    schedule: (parent: any) => {
      if (!parent.schedule) return null
      const schedule = typeof parent.schedule === 'string' ? JSON.parse(parent.schedule) : parent.schedule
      return {
        days: schedule.days || [],
        hour: schedule.hour || '09',
        timezone: schedule.timezone || 'America/Mexico_City',
      }
    },

    routes: async (parent: any, _args: unknown, context: GraphQLContext) => {
      if (parent.routes) return parent.routes

      return context.prisma.route.findMany({
        where: {
          reportConfigs: {
            some: { id: parent.id },
          },
        },
      })
    },

    telegramRecipients: async (parent: any, _args: unknown, context: GraphQLContext) => {
      if (parent.telegramRecipients) return parent.telegramRecipients

      return context.prisma.telegramUser.findMany({
        where: {
          reportConfigs: {
            some: { id: parent.id },
          },
        },
      })
    },

    executionLogs: async (parent: any, _args: unknown, context: GraphQLContext) => {
      if (parent.executionLogs) return parent.executionLogs

      return context.prisma.reportExecutionLog.findMany({
        where: { reportConfig: parent.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
    },
  },

  ReportExecutionLog: {
    reportConfig: async (parent: any, _args: unknown, context: GraphQLContext) => {
      if (parent.reportConfigRelation) return parent.reportConfigRelation

      return context.prisma.reportConfig.findUnique({
        where: { id: parent.reportConfig },
      })
    },
  },

  DocumentWithNotificationStatus: {
    document: (parent: any) => parent.document,
    notificationSent: (parent: any) => parent.notificationSent,
    lastNotification: (parent: any) => parent.lastNotification,
  },
}
