import jwt from 'jsonwebtoken'
import { GraphQLError } from 'graphql'
import type { User, UserRole, PrismaClient } from '@solufacil/database'
import { UserService } from './UserService'
import {
  generateAccessToken,
  generateRefreshToken,
} from '../middleware/auth'

const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'default-refresh-secret'

interface RefreshTokenPayload {
  userId: string
  iat: number
  exp: number
}

export interface AuthPayload {
  accessToken: string
  refreshToken: string
  user: User
}

export class AuthService {
  private userService: UserService

  constructor(prisma: PrismaClient) {
    this.userService = new UserService(prisma)
  }

  async login(email: string, password: string): Promise<AuthPayload> {
    const user = await this.userService.verifyCredentials(email, password)

    if (!user) {
      throw new GraphQLError('Invalid credentials', {
        extensions: { code: 'UNAUTHENTICATED' },
      })
    }

    const accessToken = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    })

    const refreshToken = generateRefreshToken(user.id)

    return {
      accessToken,
      refreshToken,
      user,
    }
  }

  async refreshToken(token: string): Promise<AuthPayload> {
    try {
      const payload = jwt.verify(
        token,
        JWT_REFRESH_SECRET
      ) as RefreshTokenPayload

      // Obtener usuario actualizado
      const user = await this.userService.findById(payload.userId)

      if (!user) {
        throw new GraphQLError('User not found', {
          extensions: { code: 'UNAUTHENTICATED' },
        })
      }

      // Generar nuevos tokens
      const accessToken = generateAccessToken({
        id: user.id,
        email: user.email,
        role: user.role,
      })

      const newRefreshToken = generateRefreshToken(user.id)

      return {
        accessToken,
        refreshToken: newRefreshToken,
        user,
      }
    } catch (error) {
      throw new GraphQLError('Invalid or expired refresh token', {
        extensions: { code: 'UNAUTHENTICATED' },
      })
    }
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<boolean> {
    return this.userService.changePassword(userId, oldPassword, newPassword)
  }
}
