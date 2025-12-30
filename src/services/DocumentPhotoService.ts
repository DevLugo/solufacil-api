import { GraphQLError } from 'graphql'
import type { PrismaClient, DocumentType } from '@solufacil/database'
import type { ReadStream } from 'fs'
import { DocumentPhotoRepository } from '../repositories/DocumentPhotoRepository'
import { CloudinaryService } from './CloudinaryService'
import { TelegramService } from './TelegramService'

export interface UploadDocumentInput {
  title?: string
  description?: string
  documentType: DocumentType
  file: {
    createReadStream: () => ReadStream
    filename: string
    mimetype: string
  }
  personalDataId?: string
  loanId?: string
  isError?: boolean
  errorDescription?: string
  isMissing?: boolean
}

export interface UpdateDocumentInput {
  title?: string
  description?: string
  isError?: boolean
  errorDescription?: string
  isMissing?: boolean
}

export class DocumentPhotoService {
  private documentPhotoRepository: DocumentPhotoRepository
  private cloudinaryService: CloudinaryService

  constructor(private prisma: PrismaClient) {
    this.documentPhotoRepository = new DocumentPhotoRepository(prisma)
    this.cloudinaryService = new CloudinaryService()
  }

  async findById(id: string) {
    const document = await this.documentPhotoRepository.findById(id)
    if (!document) {
      throw new GraphQLError('Document photo not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }
    return document
  }

  async findMany(options?: {
    loanId?: string
    personalDataId?: string
    documentType?: DocumentType
    hasErrors?: boolean
    isMissing?: boolean
    limit?: number
    offset?: number
  }) {
    return this.documentPhotoRepository.findMany(options)
  }

  async upload(input: UploadDocumentInput, userId: string) {
    // Validate that at least one of personalDataId or loanId is provided
    if (!input.personalDataId && !input.loanId) {
      throw new GraphQLError(
        'Either personalDataId or loanId must be provided',
        {
          extensions: { code: 'BAD_USER_INPUT' },
        }
      )
    }

    // Validate mimetype
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedMimeTypes.includes(input.file.mimetype)) {
      throw new GraphQLError(
        `Invalid file type: ${input.file.mimetype}. Allowed types: ${allowedMimeTypes.join(', ')}`,
        {
          extensions: { code: 'BAD_USER_INPUT' },
        }
      )
    }

    console.log('=== Starting upload process ===')
    console.log('Input:', {
      documentType: input.documentType,
      loanId: input.loanId,
      personalDataId: input.personalDataId,
      hasFile: !!input.file,
    })

    // Check if a document with this type already exists for this person/loan
    const existingDocs = await this.documentPhotoRepository.findMany({
      loanId: input.loanId,
      personalDataId: input.personalDataId,
      documentType: input.documentType,
    })

    console.log('Existing documents found:', existingDocs.length)
    if (existingDocs.length > 0) {
      console.log('Existing doc details:', {
        id: existingDocs[0].id,
        photoUrl: existingDocs[0].photoUrl,
        publicId: existingDocs[0].publicId,
        isMissing: existingDocs[0].isMissing,
      })
    }

    // Upload to Cloudinary
    const stream = input.file.createReadStream()
    const folder = input.loanId
      ? `solufacil/loans/${input.loanId}`
      : `solufacil/personal/${input.personalDataId}`

    console.log('Uploading to Cloudinary folder:', folder)

    const uploadResult = await this.cloudinaryService.uploadImage(stream, {
      folder,
    })

    console.log('Upload result from Cloudinary:', {
      url: uploadResult.url,
      publicId: uploadResult.publicId,
      urlLength: uploadResult.url?.length || 0,
    })

    // If document already exists, update it (replacing the old one)
    if (existingDocs && existingDocs.length > 0) {
      // If there are multiple documents (duplicates), delete all except the first
      if (existingDocs.length > 1) {
        console.log(`WARNING: Found ${existingDocs.length} duplicate documents. Cleaning up...`)
        for (let i = 1; i < existingDocs.length; i++) {
          const duplicateDoc = existingDocs[i]
          console.log('Deleting duplicate document:', duplicateDoc.id)

          // Delete image from Cloudinary if exists
          if (duplicateDoc.publicId && duplicateDoc.publicId !== '') {
            try {
              await this.cloudinaryService.deleteImage(duplicateDoc.publicId)
            } catch (error) {
              console.error('Error deleting duplicate image:', error)
            }
          }

          // Delete from database
          await this.documentPhotoRepository.delete(duplicateDoc.id)
        }
      }

      const existingDoc = existingDocs[0]
      console.log('Existing document found, will update:', existingDoc.id)

      // Delete old image from Cloudinary if it exists
      if (existingDoc.publicId && existingDoc.publicId !== '') {
        try {
          console.log('Deleting old image from Cloudinary:', existingDoc.publicId)
          await this.cloudinaryService.deleteImage(existingDoc.publicId)
        } catch (error) {
          console.error('Error deleting old image from Cloudinary:', error)
          // Continue even if deletion fails
        }
      }

      // Update the existing document with new photo
      console.log('Updating document with:', {
        id: existingDoc.id,
        photoUrl: uploadResult.url,
        publicId: uploadResult.publicId,
        willSetMissingToFalse: true,
      })

      const updatedDoc = await this.documentPhotoRepository.update(existingDoc.id, {
        photoUrl: uploadResult.url,
        publicId: uploadResult.publicId,
        title: input.title || `${input.documentType} - Actualizado`,
        description: input.description || 'Documento actualizado',
        isError: input.isError ?? false,
        errorDescription: input.errorDescription,
        isMissing: false, // Important: set to false when uploading a photo
      })

      console.log('Updated document result:', {
        id: updatedDoc.id,
        photoUrl: updatedDoc.photoUrl,
        publicId: updatedDoc.publicId,
        isMissing: updatedDoc.isMissing,
        photoUrlLength: updatedDoc.photoUrl?.length || 0,
      })
      return updatedDoc
    }

    // Create new document photo record if none exists
    console.log('No existing document found, creating new one')
    const newDoc = await this.documentPhotoRepository.create({
      photoUrl: uploadResult.url,
      publicId: uploadResult.publicId,
      documentType: input.documentType,
      title: input.title,
      description: input.description,
      personalDataId: input.personalDataId,
      loanId: input.loanId,
      uploadedById: userId,
      isError: input.isError ?? false,
      errorDescription: input.errorDescription,
      isMissing: false, // Always false when uploading a photo
    })

    console.log('Created new document:', {
      id: newDoc.id,
      photoUrl: newDoc.photoUrl,
      publicId: newDoc.publicId,
      isMissing: newDoc.isMissing,
      photoUrlLength: newDoc.photoUrl?.length || 0,
    })

    return newDoc
  }

  async update(id: string, input: UpdateDocumentInput) {
    // Get current document state before update
    const currentDoc = await this.documentPhotoRepository.findById(id)
    if (!currentDoc) {
      throw new GraphQLError('Document photo not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    const wasError = currentDoc.isError
    const wasMissing = currentDoc.isMissing

    const updatedDoc = await this.documentPhotoRepository.update(id, {
      title: input.title,
      description: input.description,
      isError: input.isError,
      errorDescription: input.errorDescription,
      isMissing: input.isMissing,
    })

    // Check if document was just marked as error or missing (state changed to true)
    const becameError = !wasError && input.isError === true
    const becameMissing = !wasMissing && input.isMissing === true

    if (becameError || becameMissing) {
      // Send notification asynchronously (don't block the response)
      this.sendDocumentIssueNotification(
        id,
        becameError ? 'ERROR' : 'MISSING',
        input.errorDescription
      ).catch((error) => {
        console.error('❌ [DocumentPhotoService] Error sending notification:', error)
      })
    }

    return updatedDoc
  }

  /**
   * Sends Telegram notification when a document is marked as error or missing
   * Based on active ReportConfig with reportType 'NOTIFICACION_TIEMPO_REAL'
   */
  private async sendDocumentIssueNotification(
    documentId: string,
    issueType: 'ERROR' | 'MISSING',
    errorDescription?: string
  ): Promise<void> {
    console.log('📨 [sendDocumentIssueNotification] Starting notification process', {
      documentId,
      issueType,
      errorDescription,
    })

    try {
      // 1. Get active ReportConfigs for realtime notifications
      // Note: reportType is stored in lowercase in the database
      const reportConfigs = await this.prisma.reportConfig.findMany({
        where: {
          reportType: { in: ['NOTIFICACION_TIEMPO_REAL', 'notificacion_tiempo_real'] },
          isActive: true,
        },
        include: {
          telegramRecipients: {
            where: { isActive: true },
          },
        },
      })

      if (reportConfigs.length === 0) {
        console.log('⚠️ [sendDocumentIssueNotification] No active realtime notification configs found')
        return
      }

      // 2. Collect unique telegram users from all configs
      const telegramUsersMap = new Map<string, { id: string; chatId: string; name: string }>()
      for (const config of reportConfigs) {
        for (const user of config.telegramRecipients) {
          if (user.chatId && user.isActive) {
            telegramUsersMap.set(user.id, {
              id: user.id,
              chatId: user.chatId,
              name: user.name,
            })
          }
        }
      }

      const telegramUsers = Array.from(telegramUsersMap.values())
      if (telegramUsers.length === 0) {
        console.log('⚠️ [sendDocumentIssueNotification] No active Telegram users in configs')
        return
      }

      console.log('📱 [sendDocumentIssueNotification] Found recipients:', telegramUsers.length)

      // 3. Get full document info with relations
      const document = await this.prisma.documentPhoto.findUnique({
        where: { id: documentId },
        include: {
          personalDataRelation: true,
          loanRelation: {
            include: {
              borrowerRelation: {
                include: {
                  personalDataRelation: true,
                },
              },
              leadRelation: {
                include: {
                  personalDataRelation: true,
                  routes: true,
                },
              },
            },
          },
        },
      })

      if (!document) {
        console.log('❌ [sendDocumentIssueNotification] Document not found')
        return
      }

      // 4. Build notification message
      const docType = document.documentType?.toUpperCase() || 'DOCUMENTO'
      const personName = document.personalDataRelation?.fullName || 'Sin nombre'
      const borrowerName = document.loanRelation?.borrowerRelation?.personalDataRelation?.fullName || 'Sin nombre'
      const signDate = document.loanRelation?.signDate
        ? new Date(document.loanRelation.signDate).toLocaleDateString('es-MX')
        : 'No disponible'
      const routeName = document.loanRelation?.leadRelation?.routes?.[0]?.name || 'Sin ruta'
      const leadName = document.loanRelation?.leadRelation?.personalDataRelation?.fullName || 'Sin líder'
      const currentDate = new Date().toLocaleString('es-MX')
      const errorDesc = errorDescription || document.errorDescription || ''

      let message: string
      if (issueType === 'ERROR') {
        message = `🚨 <b>DOCUMENTO CON ERROR</b>

📋 Tipo: ${docType}
💰 Crédito de: ${borrowerName}
📅 Fecha de firma: ${signDate}
👤 Persona: ${personName}
🛣️ Ruta: ${routeName}
👨‍💼 Líder: ${leadName}

❌ <b>Descripción del Error:</b>
${errorDesc || 'Sin descripción'}

📅 Fecha: ${currentDate}`
      } else {
        message = `📋 <b>DOCUMENTO FALTANTE</b>

📋 Tipo: ${docType}
💰 Crédito de: ${borrowerName}
📅 Fecha de firma: ${signDate}
👤 Persona: ${personName}
🛣️ Ruta: ${routeName}
👨‍💼 Líder: ${leadName}

📅 Fecha: ${currentDate}`
      }

      // 5. Send to all recipients
      const telegramService = new TelegramService()
      let successCount = 0
      let errorCount = 0

      for (const user of telegramUsers) {
        try {
          // If error and has photo, send with photo
          if (issueType === 'ERROR' && document.photoUrl) {
            await telegramService.sendPhoto(user.chatId, document.photoUrl, {
              caption: message,
              parseMode: 'HTML',
            })
          } else {
            await telegramService.sendMessage(user.chatId, message)
          }
          successCount++
          console.log(`✅ [sendDocumentIssueNotification] Sent to ${user.name}`)
        } catch (error) {
          errorCount++
          console.error(`❌ [sendDocumentIssueNotification] Failed to send to ${user.name}:`, error)
        }
      }

      console.log(`📊 [sendDocumentIssueNotification] Results: ${successCount} sent, ${errorCount} failed`)
    } catch (error) {
      console.error('❌ [sendDocumentIssueNotification] Error:', error)
    }
  }

  async delete(id: string): Promise<boolean> {
    const document = await this.documentPhotoRepository.findById(id)
    if (!document) {
      throw new GraphQLError('Document photo not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    console.log('Deleting document:', {
      id: document.id,
      publicId: document.publicId,
      hasImage: !!document.publicId && document.publicId !== ''
    })

    // Delete from Cloudinary only if there's an actual image
    if (document.publicId && document.publicId !== '') {
      try {
        const deleted = await this.cloudinaryService.deleteImage(document.publicId)
        console.log('Cloudinary deletion successful:', deleted)
      } catch (error) {
        console.error('Error deleting image from Cloudinary, but continuing with DB deletion:', error)
        // Continue with database deletion even if Cloudinary fails
        // This allows the user to clean up orphaned records
      }
    } else {
      console.log('No image to delete from Cloudinary (empty publicId)')
    }

    // Delete from database
    await this.documentPhotoRepository.delete(id)
    console.log('Document deleted from database:', id)

    return true
  }

  async findWithErrors(routeId?: string) {
    return this.documentPhotoRepository.findWithErrors({ routeId })
  }

  async markAsMissing(
    loanId: string,
    personalDataId: string,
    documentType: DocumentType,
    userId: string
  ) {
    console.log('=== Marking document as missing ===')
    console.log('Input:', { documentType, loanId, personalDataId })

    // Check if a document with this type already exists for this person/loan
    const existingDocs = await this.documentPhotoRepository.findMany({
      loanId,
      personalDataId,
      documentType,
    })

    console.log('Existing documents found:', existingDocs.length)

    // If document already exists, update it to mark as missing
    if (existingDocs && existingDocs.length > 0) {
      // If there are multiple documents (duplicates), delete all except the first
      if (existingDocs.length > 1) {
        console.log(`WARNING: Found ${existingDocs.length} duplicate documents. Cleaning up...`)
        for (let i = 1; i < existingDocs.length; i++) {
          const duplicateDoc = existingDocs[i]
          console.log('Deleting duplicate document:', duplicateDoc.id)

          // Delete image from Cloudinary if exists
          if (duplicateDoc.publicId && duplicateDoc.publicId !== '') {
            try {
              await this.cloudinaryService.deleteImage(duplicateDoc.publicId)
            } catch (error) {
              console.error('Error deleting duplicate image:', error)
            }
          }

          // Delete from database
          await this.documentPhotoRepository.delete(duplicateDoc.id)
        }
      }

      const existingDoc = existingDocs[0]

      // Delete old image from Cloudinary if it exists (cleaning up before marking as missing)
      if (existingDoc.publicId && existingDoc.publicId !== '') {
        console.log('Document has image, deleting from Cloudinary:', existingDoc.publicId)
        try {
          await this.cloudinaryService.deleteImage(existingDoc.publicId)
        } catch (error) {
          console.error('Error deleting old image from Cloudinary:', error)
          // Continue even if deletion fails
        }
      }

      // Check if it was already missing
      const wasMissing = existingDoc.isMissing

      // Update to mark as missing and clear photo fields
      console.log('Updating document to mark as missing:', existingDoc.id)
      const updatedDoc = await this.documentPhotoRepository.update(existingDoc.id, {
        photoUrl: '',
        publicId: '',
        isMissing: true,
        isError: false,
        errorDescription: undefined,
        title: `${documentType} - Sin documento`,
        description: 'Documento marcado como no disponible',
      })

      // Send notification if it wasn't already missing
      if (!wasMissing) {
        this.sendDocumentIssueNotification(existingDoc.id, 'MISSING').catch((error) => {
          console.error('❌ [markAsMissing] Error sending notification:', error)
        })
      }

      return updatedDoc
    }

    // Create new document record marked as missing (without photo)
    console.log('No existing document, creating new one marked as missing')
    const newDoc = await this.documentPhotoRepository.create({
      photoUrl: '',
      publicId: '',
      documentType,
      title: `${documentType} - Sin documento`,
      description: 'Documento marcado como no disponible',
      personalDataId,
      loanId,
      uploadedById: userId,
      isError: false,
      isMissing: true,
    })

    // Send notification for new missing document
    this.sendDocumentIssueNotification(newDoc.id, 'MISSING').catch((error) => {
      console.error('❌ [markAsMissing] Error sending notification:', error)
    })

    return newDoc
  }
}
