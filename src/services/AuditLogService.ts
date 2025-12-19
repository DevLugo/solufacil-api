import type { PrismaClient } from '@solufacil/database'
import { AuditLogRepository, AuditOperation } from '../repositories/AuditLogRepository'

export interface AuditContext {
  userId?: string
  userName?: string
  userEmail?: string
  userRole?: string
  sessionId?: string
  ipAddress?: string
  userAgent?: string
}

export class AuditLogService {
  private auditLogRepository: AuditLogRepository

  constructor(private prisma: PrismaClient) {
    this.auditLogRepository = new AuditLogRepository(prisma)
  }

  async log(
    operation: AuditOperation,
    modelName: string,
    recordId: string,
    context?: AuditContext,
    options?: {
      previousValues?: Record<string, unknown>
      newValues?: Record<string, unknown>
      description?: string
      metadata?: Record<string, unknown>
    }
  ) {
    // Calculate changed fields
    let changedFields: string[] | undefined
    if (options?.previousValues && options?.newValues) {
      changedFields = this.calculateChangedFields(
        options.previousValues,
        options.newValues
      )
    }

    return this.auditLogRepository.create({
      operation,
      modelName,
      recordId,
      userId: context?.userId,
      userName: context?.userName,
      userEmail: context?.userEmail,
      userRole: context?.userRole,
      sessionId: context?.sessionId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      previousValues: options?.previousValues,
      newValues: options?.newValues,
      changedFields,
      description: options?.description,
      metadata: options?.metadata,
    })
  }

  async logCreate(
    modelName: string,
    recordId: string,
    newValues: Record<string, unknown>,
    context?: AuditContext,
    description?: string
  ) {
    return this.log('CREATE', modelName, recordId, context, {
      newValues,
      description: description || `Created ${modelName} ${recordId}`,
    })
  }

  async logUpdate(
    modelName: string,
    recordId: string,
    previousValues: Record<string, unknown>,
    newValues: Record<string, unknown>,
    context?: AuditContext,
    description?: string
  ) {
    return this.log('UPDATE', modelName, recordId, context, {
      previousValues,
      newValues,
      description: description || `Updated ${modelName} ${recordId}`,
    })
  }

  async logDelete(
    modelName: string,
    recordId: string,
    previousValues: Record<string, unknown>,
    context?: AuditContext,
    description?: string
  ) {
    return this.log('DELETE', modelName, recordId, context, {
      previousValues,
      description: description || `Deleted ${modelName} ${recordId}`,
    })
  }

  async getAuditHistory(
    modelName: string,
    recordId: string
  ) {
    return this.auditLogRepository.findByRecordId(modelName, recordId)
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
    return this.auditLogRepository.findMany(options)
  }

  async getStats(options?: {
    fromDate?: Date
    toDate?: Date
  }) {
    const [creates, updates, deletes] = await Promise.all([
      this.auditLogRepository.count({
        operation: 'CREATE',
        fromDate: options?.fromDate,
        toDate: options?.toDate,
      }),
      this.auditLogRepository.count({
        operation: 'UPDATE',
        fromDate: options?.fromDate,
        toDate: options?.toDate,
      }),
      this.auditLogRepository.count({
        operation: 'DELETE',
        fromDate: options?.fromDate,
        toDate: options?.toDate,
      }),
    ])

    return {
      creates,
      updates,
      deletes,
      total: creates + updates + deletes,
    }
  }

  private calculateChangedFields(
    previousValues: Record<string, unknown>,
    newValues: Record<string, unknown>
  ): string[] {
    const changedFields: string[] = []
    const allKeys = new Set([
      ...Object.keys(previousValues),
      ...Object.keys(newValues),
    ])

    for (const key of allKeys) {
      const prevValue = previousValues[key]
      const newValue = newValues[key]

      if (JSON.stringify(prevValue) !== JSON.stringify(newValue)) {
        changedFields.push(key)
      }
    }

    return changedFields
  }
}
