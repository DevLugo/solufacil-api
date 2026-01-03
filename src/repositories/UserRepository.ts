import type { PrismaClient, User, UserRole, EmployeeType, Prisma } from '@solufacil/database'

export class UserRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    })
  }

  async findByIdWithEmployee(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        employee: {
          include: {
            personalDataRelation: true,
          },
        },
      },
    })
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    })
  }

  async findByEmailWithEmployee(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        employee: {
          include: {
            personalDataRelation: true,
          },
        },
      },
    })
  }

  async findMany(options?: {
    role?: UserRole
    limit?: number
    offset?: number
  }): Promise<User[]> {
    return this.prisma.user.findMany({
      where: options?.role ? { role: options.role } : undefined,
      take: options?.limit,
      skip: options?.offset,
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data })
  }

  async createWithRelations(data: {
    name: string
    email: string
    password: string
    role: UserRole
    telegramChatId?: string
    employeeId?: string
  }): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          name: data.name,
          email: data.email,
          password: data.password,
          role: data.role,
        },
      })

      // Link to employee if provided
      if (data.employeeId) {
        await tx.employee.update({
          where: { id: data.employeeId },
          data: { user: user.id },
        })
      }

      // Create or update telegram user if chatId provided
      if (data.telegramChatId) {
        await tx.telegramUser.upsert({
          where: { chatId: data.telegramChatId },
          create: {
            chatId: data.telegramChatId,
            name: data.name,
            isActive: true,
            isInRecipientsList: true,
            platformUser: user.id,
          },
          update: {
            platformUser: user.id,
            name: data.name,
            isActive: true,
          },
        })
      }

      return user
    })
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    })
  }

  async updateWithRelations(
    id: string,
    data: {
      name?: string
      email?: string
      password?: string
      role?: UserRole
      telegramChatId?: string
      employeeId?: string
    }
  ): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      // Update user basic fields
      const updateData: Prisma.UserUpdateInput = {}
      if (data.name !== undefined) updateData.name = data.name
      if (data.email !== undefined) updateData.email = data.email
      if (data.password !== undefined) updateData.password = data.password
      if (data.role !== undefined) updateData.role = data.role

      const user = await tx.user.update({
        where: { id },
        data: updateData,
      })

      // Handle employee link
      if (data.employeeId !== undefined) {
        // First, unlink any currently linked employee
        await tx.employee.updateMany({
          where: { user: id },
          data: { user: null },
        })

        // Then link the new employee if provided
        if (data.employeeId) {
          await tx.employee.update({
            where: { id: data.employeeId },
            data: { user: id },
          })
        }
      }

      // Handle telegram user
      if (data.telegramChatId !== undefined) {
        // First, unlink any currently linked telegram user
        await tx.telegramUser.updateMany({
          where: { platformUser: id },
          data: { platformUser: null },
        })

        // Then create/update telegram user if chatId provided
        if (data.telegramChatId) {
          await tx.telegramUser.upsert({
            where: { chatId: data.telegramChatId },
            create: {
              chatId: data.telegramChatId,
              name: data.name || user.name,
              isActive: true,
              isInRecipientsList: true,
              platformUser: id,
            },
            update: {
              platformUser: id,
              isActive: true,
            },
          })
        }
      }

      return user
    })
  }

  async delete(id: string): Promise<boolean> {
    await this.prisma.user.delete({
      where: { id },
    })
    return true
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { id },
    })
    return count > 0
  }

  async emailExists(email: string, excludeId?: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: {
        email,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    })
    return count > 0
  }

  async createEmployee(data: {
    type: EmployeeType
    fullName: string
    personalDataId?: string
  }) {
    let personalDataId = data.personalDataId

    // Si no se proporciona personalDataId, crear uno nuevo
    if (!personalDataId) {
      const personalData = await this.prisma.personalData.create({
        data: {
          fullName: data.fullName,
          clientCode: `EMP-${Date.now()}`,
        },
      })
      personalDataId = personalData.id
    } else {
      // Verificar que el personalData existe y no está ya asociado a un empleado
      const existingEmployee = await this.prisma.employee.findUnique({
        where: { personalData: personalDataId },
      })

      if (existingEmployee) {
        throw new Error(
          'Esta persona ya está registrada como empleado'
        )
      }
    }

    // Create employee linked to personal data
    return this.prisma.employee.create({
      data: {
        type: data.type,
        personalData: personalDataId,
      },
    })
  }
}
