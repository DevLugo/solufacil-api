import { v2 as cloudinary, UploadApiResponse } from 'cloudinary'
import { GraphQLError } from 'graphql'
import type { ReadStream } from 'fs'

export interface UploadResult {
  url: string
  publicId: string
}

export interface CloudinaryConfig {
  cloudName: string
  apiKey: string
  apiSecret: string
}

export class CloudinaryService {
  private isConfigured: boolean = false

  constructor(config?: CloudinaryConfig) {
    const cloudName = config?.cloudName || process.env.CLOUDINARY_CLOUD_NAME
    const apiKey = config?.apiKey || process.env.CLOUDINARY_API_KEY
    const apiSecret = config?.apiSecret || process.env.CLOUDINARY_API_SECRET

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      })
      this.isConfigured = true
    }
  }

  private ensureConfigured(): void {
    if (!this.isConfigured) {
      throw new GraphQLError('Cloudinary is not configured', {
        extensions: { code: 'INTERNAL_ERROR' },
      })
    }
  }

  async uploadImage(
    fileStream: ReadStream,
    options?: {
      folder?: string
      publicId?: string
      transformation?: Record<string, unknown>
    }
  ): Promise<UploadResult> {
    this.ensureConfigured()

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: options?.folder || 'solufacil/documents',
          public_id: options?.publicId,
          resource_type: 'image',
          transformation: options?.transformation || [
            { quality: 'auto:good' },
            { fetch_format: 'auto' },
          ],
        },
        (error, result) => {
          if (error) {
            reject(
              new GraphQLError(`Failed to upload image: ${error.message}`, {
                extensions: { code: 'UPLOAD_ERROR' },
              })
            )
            return
          }

          if (!result) {
            reject(
              new GraphQLError('Upload failed: No result returned', {
                extensions: { code: 'UPLOAD_ERROR' },
              })
            )
            return
          }

          resolve({
            url: result.secure_url,
            publicId: result.public_id,
          })
        }
      )

      fileStream.pipe(uploadStream)
    })
  }

  async uploadBuffer(
    buffer: Buffer,
    options?: {
      folder?: string
      publicId?: string
      transformation?: Record<string, unknown>
    }
  ): Promise<UploadResult> {
    this.ensureConfigured()

    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: options?.folder || 'solufacil/documents',
            public_id: options?.publicId,
            resource_type: 'image',
            transformation: options?.transformation || [
              { quality: 'auto:good' },
              { fetch_format: 'auto' },
            ],
          },
          (error, result) => {
            if (error) {
              reject(
                new GraphQLError(`Failed to upload image: ${error.message}`, {
                  extensions: { code: 'UPLOAD_ERROR' },
                })
              )
              return
            }

            if (!result) {
              reject(
                new GraphQLError('Upload failed: No result returned', {
                  extensions: { code: 'UPLOAD_ERROR' },
                })
              )
              return
            }

            resolve({
              url: result.secure_url,
              publicId: result.public_id,
            })
          }
        )
        .end(buffer)
    })
  }

  async deleteImage(publicId: string): Promise<boolean> {
    this.ensureConfigured()

    try {
      console.log('Attempting to delete from Cloudinary:', publicId)
      const result = await cloudinary.uploader.destroy(publicId)
      console.log('Cloudinary delete result:', result)

      // Cloudinary returns result.result with values: 'ok', 'not found', or error
      // We consider 'not found' as success since the image doesn't exist anyway
      if (result.result === 'ok' || result.result === 'not found') {
        return true
      }

      console.warn('Unexpected Cloudinary result:', result)
      return false
    } catch (error) {
      console.error('Cloudinary delete error:', error)
      throw new GraphQLError(
        `Failed to delete image: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
        {
          extensions: {
            code: 'DELETE_ERROR',
            publicId,
            originalError: error instanceof Error ? error.message : String(error)
          },
        }
      )
    }
  }

  async getImageUrl(
    publicId: string,
    options?: {
      width?: number
      height?: number
      crop?: string
      quality?: string
    }
  ): Promise<string> {
    this.ensureConfigured()

    return cloudinary.url(publicId, {
      secure: true,
      width: options?.width,
      height: options?.height,
      crop: options?.crop || 'fill',
      quality: options?.quality || 'auto:good',
      fetch_format: 'auto',
    })
  }
}
