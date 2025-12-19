import type { PrismaClient, Prisma } from '@solufacil/database'

export type AuditOperation = 'CREATE' | 'UPDATE' | 'DELETE'

export class AuditLogRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    operation: AuditOperation
    modelName: string
    recordId: string
    userId?: string
    userName?: string
    userEmail?: string
    userRole?: string
    sessionId?: string
    ipAddress?: string
    userAgent?: string
    previousValues?: Record<string, unknown>
    newValues?: Record<string, unknown>
    changedFields?: string[]
    description?: string
    metadata?: Record<string, unknown>
  }) {
    return this.prisma.auditLog.create({
      data: {
        operation: data.operation,
        modelName: data.modelName,
        recordId: data.recordId,
        user: data.userId,
        userName: data.userName,
        userEmail: data.userEmail,
        userRole: data.userRole,
        sessionId: data.sessionId,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        previousValues: data.previousValues as Prisma.JsonObject,
        newValues: data.newValues as Prisma.JsonObject,
        changedFields: data.changedFields as Prisma.JsonArray,
        description: data.description,
        metadata: data.metadata as Prisma.JsonObject,
      },
    })
  }

  async findMany(options?: {
    operation?: AuditOperation
    modelName?: string
    recordId?: string
    userId?: string
    fromDate?: Date
    toDate?: Date
    limit?: number
    offset?: number
  }) {
    const where: Prisma.AuditLogWhereInput = {}

    if (options?.operation) {
      where.operation = options.operation
    }

    if (options?.modelName) {
      where.modelName = options.modelName
    }

    if (options?.recordId) {
      where.recordId = options.recordId
    }

    if (options?.userId) {
      where.user = options.userId
    }

    if (options?.fromDate || options?.toDate) {
      where.createdAt = {}
      if (options?.fromDate) {
        where.createdAt.gte = options.fromDate
      }
      if (options?.toDate) {
        where.createdAt.lte = options.toDate
      }
    }

    return this.prisma.auditLog.findMany({
      where,
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
      orderBy: { createdAt: 'desc' },
      include: {
        userRelation: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    })
  }

  async findByRecordId(modelName: string, recordId: string) {
    return this.prisma.auditLog.findMany({
      where: {
        modelName,
        recordId,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        userRelation: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    })
  }

  async count(options?: {
    operation?: AuditOperation
    modelName?: string
    fromDate?: Date
    toDate?: Date
  }) {
    const where: Prisma.AuditLogWhereInput = {}

    if (options?.operation) {
      where.operation = options.operation
    }

    if (options?.modelName) {
      where.modelName = options.modelName
    }

    if (options?.fromDate || options?.toDate) {
      where.createdAt = {}
      if (options?.fromDate) {
        where.createdAt.gte = options.fromDate
      }
      if (options?.toDate) {
        where.createdAt.lte = options.toDate
      }
    }

    return this.prisma.auditLog.count({ where })
  }
}
