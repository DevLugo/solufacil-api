import jwt, { SignOptions } from 'jsonwebtoken'
import { GraphQLError } from 'graphql'
import type { GraphQLContext } from '@solufacil/graphql-schema'
import { UserRole } from '@solufacil/database'

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me'
const ACCESS_TOKEN_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '15m') as SignOptions['expiresIn']
const REFRESH_TOKEN_EXPIRES_IN = (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as SignOptions['expiresIn']

export interface JWTPayload {
  userId: string
  email: string
  role: UserRole
  iat: number
  exp: number
}

/**
 * Extraer el token del header Authorization
 */
export function extractToken(authHeader?: string): string | null {
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null
  return parts[1]
}

/**
 * Verificar y decodificar un JWT token
 */
export function verifyToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload
  } catch (error) {
    throw new GraphQLError('Invalid or expired token', {
      extensions: { code: 'UNAUTHENTICATED' },
    })
  }
}

/**
 * Middleware de autenticación para verificar el token
 */
export function authenticateUser(context: GraphQLContext): void {
  const authHeader = context.req.headers.authorization
  const token = extractToken(authHeader)

  if (!token) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    })
  }

  const payload = verifyToken(token)

  context.user = {
    id: payload.userId,
    email: payload.email,
    role: payload.role,
  }
}

/**
 * Verificar que el usuario tenga uno de los roles requeridos
 */
export function requireRole(context: GraphQLContext, roles: UserRole[]): void {
  if (!context.user) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    })
  }

  if (!roles.includes(context.user.role)) {
    throw new GraphQLError('Insufficient permissions', {
      extensions: { code: 'FORBIDDEN' },
    })
  }
}

/**
 * Autentica y verifica rol en una sola llamada
 */
export function requireAnyRole(context: GraphQLContext, roles: UserRole[]): void {
  authenticateUser(context)
  requireRole(context, roles)
}

/**
 * Generar un JWT access token
 * Incluye 'kid' en el header para compatibilidad con PowerSync
 */
export function generateAccessToken(user: {
  id: string
  email: string
  role: UserRole
}): string {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      // Add sub claim for PowerSync compatibility
      sub: user.id,
      // Add aud claim for PowerSync (required)
      aud: 'powersync',
    },
    JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      // Add key ID for PowerSync to identify the signing key
      keyid: 'powersync-key',
    }
  )
}

/**
 * Generar un JWT refresh token
 */
export function generateRefreshToken(userId: string): string {
  const refreshSecret = process.env.JWT_REFRESH_SECRET || 'default-refresh-secret'
  return jwt.sign({ userId }, refreshSecret, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
  })
}
