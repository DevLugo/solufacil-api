/**
 * Genera un código de cliente alfanumérico de 6 caracteres
 */
export function generateClientCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

/**
 * Capitaliza la primera letra de cada palabra
 */
export function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, (char) => char.toUpperCase())
}

/**
 * Formatea un número de teléfono a formato legible
 */
export function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
  }
  return phone
}

/**
 * Genera un código corto alfanumérico desde un ID
 * Útil para mostrar IDs largos de forma compacta
 */
export function generateShortCode(id?: string, length: number = 6): string {
  if (!id) return ''
  const base = id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  return base.slice(-length)
}

/**
 * Convierte un string a slug (URL-friendly)
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w-]+/g, '')
}
