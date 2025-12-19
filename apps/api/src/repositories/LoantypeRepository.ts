import type { PrismaClient, Loantype, Prisma } from '@solufacil/database'
import { Decimal } from 'decimal.js'

export class LoantypeRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<Loantype | null> {
    return this.prisma.loantype.findUnique({
      where: { id },
    })
  }

  async findMany(): Promise<Loantype[]> {
    // Note: isActive field doesn't exist in Loantype schema
    return this.prisma.loantype.findMany({
      orderBy: { name: 'asc' },
    })
  }

  async create(data: {
    name: string
    weekDuration: number
    rate: number | Decimal
    loanPaymentComission: number | Decimal
    loanGrantedComission: number | Decimal
  }): Promise<Loantype> {
    return this.prisma.loantype.create({
      data: {
        name: data.name,
        weekDuration: data.weekDuration,
        rate: data.rate,
        loanPaymentComission: data.loanPaymentComission,
        loanGrantedComission: data.loanGrantedComission,
      },
    })
  }

  async update(
    id: string,
    data: {
      name?: string
      weekDuration?: number
      rate?: number | Decimal
      loanPaymentComission?: number | Decimal
      loanGrantedComission?: number | Decimal
    }
  ): Promise<Loantype> {
    return this.prisma.loantype.update({
      where: { id },
      data,
    })
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.prisma.loantype.count({
      where: { id },
    })
    return count > 0
  }
}
