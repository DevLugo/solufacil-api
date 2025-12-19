import { GraphQLError } from 'graphql'

export interface TelegramConfig {
  botToken: string
}

export interface SendMessageOptions {
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'
  disableWebPagePreview?: boolean
  disableNotification?: boolean
}

export interface TelegramResponse {
  ok: boolean
  result?: unknown
  description?: string
}

export class TelegramService {
  private botToken: string
  private baseUrl: string
  private isConfigured: boolean = false

  constructor(config?: TelegramConfig) {
    const token = config?.botToken || process.env.TELEGRAM_BOT_TOKEN

    if (token) {
      this.botToken = token
      this.baseUrl = `https://api.telegram.org/bot${this.botToken}`
      this.isConfigured = true
    } else {
      this.botToken = ''
      this.baseUrl = ''
    }
  }

  private ensureConfigured(): void {
    if (!this.isConfigured) {
      throw new GraphQLError('Telegram bot is not configured', {
        extensions: { code: 'INTERNAL_ERROR' },
      })
    }
  }

  async sendMessage(
    chatId: string,
    text: string,
    options?: SendMessageOptions
  ): Promise<TelegramResponse> {
    this.ensureConfigured()

    try {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: options?.parseMode || 'HTML',
          disable_web_page_preview: options?.disableWebPagePreview ?? true,
          disable_notification: options?.disableNotification ?? false,
        }),
      })

      const data = await response.json()
      return data as TelegramResponse
    } catch (error) {
      throw new GraphQLError(
        `Failed to send Telegram message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {
          extensions: { code: 'TELEGRAM_ERROR' },
        }
      )
    }
  }

  async sendDocument(
    chatId: string,
    document: Buffer | string,
    options?: {
      filename?: string
      caption?: string
      parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'
    }
  ): Promise<TelegramResponse> {
    this.ensureConfigured()

    try {
      const formData = new FormData()
      formData.append('chat_id', chatId)

      if (typeof document === 'string') {
        // URL
        formData.append('document', document)
      } else {
        // Buffer
        const blob = new Blob([document])
        formData.append('document', blob, options?.filename || 'document')
      }

      if (options?.caption) {
        formData.append('caption', options.caption)
      }
      if (options?.parseMode) {
        formData.append('parse_mode', options.parseMode)
      }

      const response = await fetch(`${this.baseUrl}/sendDocument`, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      return data as TelegramResponse
    } catch (error) {
      throw new GraphQLError(
        `Failed to send Telegram document: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {
          extensions: { code: 'TELEGRAM_ERROR' },
        }
      )
    }
  }

  async sendPhoto(
    chatId: string,
    photo: Buffer | string,
    options?: {
      caption?: string
      parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'
    }
  ): Promise<TelegramResponse> {
    this.ensureConfigured()

    try {
      const formData = new FormData()
      formData.append('chat_id', chatId)

      if (typeof photo === 'string') {
        // URL
        formData.append('photo', photo)
      } else {
        // Buffer
        const blob = new Blob([photo], { type: 'image/jpeg' })
        formData.append('photo', blob, 'photo.jpg')
      }

      if (options?.caption) {
        formData.append('caption', options.caption)
      }
      if (options?.parseMode) {
        formData.append('parse_mode', options.parseMode)
      }

      const response = await fetch(`${this.baseUrl}/sendPhoto`, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      return data as TelegramResponse
    } catch (error) {
      throw new GraphQLError(
        `Failed to send Telegram photo: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {
          extensions: { code: 'TELEGRAM_ERROR' },
        }
      )
    }
  }

  async getMe(): Promise<TelegramResponse> {
    this.ensureConfigured()

    try {
      const response = await fetch(`${this.baseUrl}/getMe`)
      const data = await response.json()
      return data as TelegramResponse
    } catch (error) {
      throw new GraphQLError(
        `Failed to get bot info: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {
          extensions: { code: 'TELEGRAM_ERROR' },
        }
      )
    }
  }

  // Notification helpers for the application
  async notifyDocumentError(
    chatId: string,
    data: {
      documentType: string
      personName: string
      loanId?: string
      routeName?: string
      errorDescription?: string
    }
  ): Promise<TelegramResponse> {
    const message = `
<b>Error en Documento</b>

<b>Tipo:</b> ${data.documentType}
<b>Persona:</b> ${data.personName}
${data.loanId ? `<b>Préstamo:</b> ${data.loanId}` : ''}
${data.routeName ? `<b>Ruta:</b> ${data.routeName}` : ''}
${data.errorDescription ? `\n<b>Descripción:</b> ${data.errorDescription}` : ''}

Por favor, revise y corrija este documento.
    `.trim()

    return this.sendMessage(chatId, message)
  }

  async notifyMissingDocument(
    chatId: string,
    data: {
      documentType: string
      personName: string
      loanId?: string
      routeName?: string
    }
  ): Promise<TelegramResponse> {
    const message = `
<b>Documento Faltante</b>

<b>Tipo:</b> ${data.documentType}
<b>Persona:</b> ${data.personName}
${data.loanId ? `<b>Préstamo:</b> ${data.loanId}` : ''}
${data.routeName ? `<b>Ruta:</b> ${data.routeName}` : ''}

Por favor, suba el documento faltante.
    `.trim()

    return this.sendMessage(chatId, message)
  }

  async notifyNewLoan(
    chatId: string,
    data: {
      borrowerName: string
      amount: string
      loantype: string
      routeName?: string
      leadName?: string
    }
  ): Promise<TelegramResponse> {
    const message = `
<b>Nuevo Préstamo Registrado</b>

<b>Cliente:</b> ${data.borrowerName}
<b>Monto:</b> $${data.amount}
<b>Tipo:</b> ${data.loantype}
${data.routeName ? `<b>Ruta:</b> ${data.routeName}` : ''}
${data.leadName ? `<b>Líder:</b> ${data.leadName}` : ''}
    `.trim()

    return this.sendMessage(chatId, message)
  }

  async notifyPaymentReceived(
    chatId: string,
    data: {
      borrowerName: string
      amount: string
      loanId: string
      pendingAmount: string
    }
  ): Promise<TelegramResponse> {
    const message = `
<b>Pago Recibido</b>

<b>Cliente:</b> ${data.borrowerName}
<b>Monto:</b> $${data.amount}
<b>Préstamo:</b> ${data.loanId}
<b>Saldo Pendiente:</b> $${data.pendingAmount}
    `.trim()

    return this.sendMessage(chatId, message)
  }
}
