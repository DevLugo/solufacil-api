import { GraphQLError } from 'graphql'
import type { GraphQLContext } from '../context'
import { UserRole } from '@solufacil/database'
import { TelegramService } from '../services/TelegramService'
import { requireAnyRole } from '../middleware/auth'

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
      let message = ''
      if (config.reportType === 'NOTIFICACION_TIEMPO_REAL') {
        message = `<b>📊 Notification Report</b>\n\n`
        message += `Routes: ${config.routes.map((r) => r.name).join(', ') || 'All'}\n`
        message += `Generated: ${new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' })}`
      } else if (config.reportType === 'CREDITOS_CON_ERRORES') {
        const routeIds = config.routes.map((r) => r.id)
        const whereClause: any = {
          OR: [{ isError: true }, { isMissing: true }],
        }

        if (routeIds.length > 0) {
          whereClause.loanRelation = {
            snapshotRouteId: { in: routeIds },
          }
        }

        const docsWithErrors = await context.prisma.documentPhoto.count({
          where: whereClause,
        })

        message = `<b>📋 Documents with Errors Report</b>\n\n`
        message += `Documents with issues: ${docsWithErrors}\n`
        message += `Routes: ${config.routes.map((r) => r.name).join(', ') || 'All'}\n`
        message += `Generated: ${new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' })}`
      }

      // Send to all recipients
      for (const recipient of config.telegramRecipients) {
        try {
          await telegramService.sendMessage(recipient.chatId, message)
          successCount++

          // Update recipient stats
          await context.prisma.telegramUser.update({
            where: { id: recipient.id },
            data: {
              reportsReceived: { increment: 1 },
              lastActivity: new Date(),
            },
          })
        } catch (error) {
          errors.push(`Error sending to ${recipient.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
