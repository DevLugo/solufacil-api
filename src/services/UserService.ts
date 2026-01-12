import bcrypt from 'bcryptjs'
import { GraphQLError } from 'graphql'
import type { User, UserRole, EmployeeType, PrismaClient } from '@solufacil/database'
import { UserRepository } from '../repositories/UserRepository'

export interface CreateUserInput {
  name: string
  email: string
  password: string
  role: UserRole
  telegramChatId?: string
  employeeId?: string
  // Para crear empleado junto con el usuario
  createEmployee?: boolean
  employeeType?: EmployeeType
  personalDataId?: string
}

export interface UpdateUserInput {
  name?: string
  email?: string
  password?: string
  role?: UserRole
  telegramChatId?: string
  employeeId?: string
}

export class UserService {
  private userRepository: UserRepository

  constructor(prisma: PrismaClient) {
    this.userRepository = new UserRepository(prisma)
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepository.findById(id)
  }

  async findByIdWithEmployee(id: string) {
    return this.userRepository.findByIdWithEmployee(id)
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findByEmail(email)
  }

  async findMany(options?: {
    role?: UserRole
    limit?: number
    offset?: number
  }): Promise<User[]> {
    return this.userRepository.findMany(options)
  }

  async create(input: CreateUserInput): Promise<User> {
    // Verificar si el email ya existe
    const emailExists = await this.userRepository.emailExists(input.email)
    if (emailExists) {
      throw new GraphQLError('Email already registered', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }

    // Hash del password
    const hashedPassword = await bcrypt.hash(input.password, 10)

    let employeeId = input.employeeId

    // Si se quiere crear un empleado junto con el usuario
    if (input.createEmployee && input.employeeType) {
      const newEmployee = await this.userRepository.createEmployee({
        type: input.employeeType,
        fullName: input.name,
        personalDataId: input.personalDataId, // Vincular PersonalData existente si se proporciona
      })
      employeeId = newEmployee.id
    }

    // Create user with optional relations
    return this.userRepository.createWithRelations({
      name: input.name,
      email: input.email,
      password: hashedPassword,
      role: input.role,
      telegramChatId: input.telegramChatId,
      employeeId,
    })
  }

  async update(id: string, input: UpdateUserInput): Promise<User> {
    // Verificar que el usuario existe
    const exists = await this.userRepository.exists(id)
    if (!exists) {
      throw new GraphQLError('User not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Si se está actualizando el email, verificar que no esté en uso
    if (input.email) {
      const emailExists = await this.userRepository.emailExists(input.email, id)
      if (emailExists) {
        throw new GraphQLError('Email already registered', {
          extensions: { code: 'BAD_USER_INPUT' },
        })
      }
    }

    // Hash password if provided
    let hashedPassword: string | undefined
    if (input.password) {
      hashedPassword = await bcrypt.hash(input.password, 10)
    }

    return this.userRepository.updateWithRelations(id, {
      name: input.name,
      email: input.email,
      password: hashedPassword,
      role: input.role,
      telegramChatId: input.telegramChatId,
      employeeId: input.employeeId,
    })
  }

  async delete(id: string): Promise<boolean> {
    // Verificar que el usuario existe
    const exists = await this.userRepository.exists(id)
    if (!exists) {
      throw new GraphQLError('User not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    return this.userRepository.delete(id)
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<boolean> {
    // Obtener usuario
    const user = await this.userRepository.findById(userId)
    if (!user) {
      throw new GraphQLError('User not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Verificar password actual
    const isValidPassword = await bcrypt.compare(oldPassword, user.password)
    if (!isValidPassword) {
      throw new GraphQLError('Invalid current password', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }

    // Hash del nuevo password
    const hashedPassword = await bcrypt.hash(newPassword, 10)

    await this.userRepository.update(userId, { password: hashedPassword })
    return true
  }

  /**
   * Admin: Set a user's password without requiring the old password
   * Only accessible by ADMIN role
   */
  async adminSetPassword(userId: string, newPassword: string): Promise<boolean> {
    // Validate password length early
    if (newPassword.length < 4) {
      throw new GraphQLError('Password must be at least 4 characters', {
        extensions: { code: 'BAD_USER_INPUT' },
      })
    }

    // Verify user exists
    const user = await this.userRepository.findById(userId)
    if (!user) {
      throw new GraphQLError('User not found', {
        extensions: { code: 'NOT_FOUND' },
      })
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 10)
    await this.userRepository.update(userId, { password: hashedPassword })

    return true
  }

  async verifyCredentials(
    email: string,
    password: string
  ) {
    const user = await this.userRepository.findByEmailWithEmployee(email)
    if (!user) return null

    // TODO: Temporalmente permite a ADMIN acceder sin verificar password
    // para poder setear los passwords de todos los usuarios
    // ELIMINAR ESTO después de configurar los passwords
    if (user.role === 'ADMIN') {
      return user
    }

    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid) return null

    return user
  }
}
