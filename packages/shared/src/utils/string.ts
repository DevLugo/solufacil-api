/**
 * Genera un código de cliente: 1 letra + 4 números (ej: A0001, B1234, Z9999)
 * Fácil de escribir, dictar y buscar
 */
export function generateClientCode(): string {
  // Letra aleatoria A-Z
  const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26))
  // Número de 4 dígitos (0000-9999)
  const number = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return letter + number
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
