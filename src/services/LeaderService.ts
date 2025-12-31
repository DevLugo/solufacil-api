import { PrismaClient } from '@solufacil/database'

interface CreateNewLeaderInput {
  fullName: string
  birthDate?: Date
  phone?: string
  locationId: string
  routeId: string
  replaceExisting?: boolean
}

export interface CreateNewLeaderResult {
  success: boolean
  message: string
  newLeaderId: string | null
  loansTransferred: number
}

export class LeaderService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Crea un nuevo líder de ruta
   * Maneja reemplazo de líderes existentes y transferencia de préstamos
   */
  async createNewLeader(input: CreateNewLeaderInput): Promise<CreateNewLeaderResult> {
    const { fullName, birthDate, phone, locationId, routeId, replaceExisting } = input

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Verificar si existe un líder en esta localidad
        const existingLeader = await tx.employee.findFirst({
          where: {
            type: 'LEAD',
            personalDataRelation: {
              addresses: {
                some: {
                  location: locationId
                }
              }
            }
          },
          include: {
            personalDataRelation: {
              include: {
                addresses: {
                  include: {
                    locationRelation: true
                  }
                }
              }
            }
          }
        })

        if (existingLeader && !replaceExisting) {
          const leaderName = existingLeader.personalDataRelation?.fullName || 'Desconocido'
          const locationName = existingLeader.personalDataRelation?.addresses[0]?.locationRelation?.name || 'Desconocida'

          return {
            success: false,
            message: `Ya existe un líder (${leaderName}) en la localidad ${locationName}. Marca la opción "Reemplazar líder existente" para continuar.`,
            newLeaderId: null,
            loansTransferred: 0
          }
        }

        // 2. Obtener información de la localidad
        const location = await tx.location.findUnique({
          where: { id: locationId },
          include: {
            municipalityRelation: {
              include: {
                stateRelation: true
              }
            }
          }
        })

        if (!location) {
          return {
            success: false,
            message: 'La localidad seleccionada no existe',
            newLeaderId: null,
            loansTransferred: 0
          }
        }

        // 3. Generar código único para el líder
        const timestamp = Date.now()
        const clientCode = `L${timestamp}`

        // 4. Crear PersonalData
        const personalData = await tx.personalData.create({
          data: {
            fullName,
            clientCode,
            birthDate: birthDate || null,
            phones: phone
              ? {
                  create: {
                    number: phone
                  }
                }
              : undefined,
            addresses: {
              create: {
                street: 'Centro',
                exteriorNumber: 'S/N',
                interiorNumber: '',
                postalCode: '00000',
                references: `Líder de ${location.name}`,
                location: locationId
              }
            }
          }
        })

        // 5. Manejar reemplazo de líder existente
        let loansTransferred = 0
        if (existingLeader && replaceExisting) {
          // Transferir préstamos activos al nuevo líder
          const activeLoans = await tx.loan.findMany({
            where: {
              lead: existingLeader.id,
              finishedDate: null,
              isDeceased: false
            }
          })

          loansTransferred = activeLoans.length

          // Marcar préstamos para transferencia
          // Nota: La transferencia real se hace después de crear el nuevo empleado
        }

        // 6. Crear Employee como LEAD
        const newEmployee = await tx.employee.create({
          data: {
            type: 'LEAD',
            personalData: personalData.id,
            routes: {
              connect: { id: routeId }
            }
          }
        })

        // 7. Transferir préstamos si hay reemplazo
        if (existingLeader && replaceExisting && loansTransferred > 0) {
          await tx.loan.updateMany({
            where: {
              lead: existingLeader.id,
              finishedDate: null,
              isDeceased: false
            },
            data: {
              lead: newEmployee.id
            }
          })

          // Eliminar el empleado antiguo
          await tx.employee.delete({
            where: { id: existingLeader.id }
          })
        }

        // 8. Construir mensaje de éxito
        let message = `Líder creado exitosamente: ${fullName} en ${location.name}`
        if (loansTransferred > 0) {
          message += `. Se transfirieron ${loansTransferred} préstamo${loansTransferred === 1 ? '' : 's'} activo${loansTransferred === 1 ? '' : 's'}.`
        }

        return {
          success: true,
          message,
          newLeaderId: newEmployee.id,
          loansTransferred
        }
      })
    } catch (error) {
      console.error('Error creating new leader:', error)
      return {
        success: false,
        message: 'Error al crear el líder. Por favor intenta de nuevo.',
        newLeaderId: null,
        loansTransferred: 0
      }
    }
  }

  /**
   * Verifica si existe un líder en una localidad
   */
  async checkExistingLeader(locationId: string) {
    const existingLeader = await this.prisma.employee.findFirst({
      where: {
        type: 'LEAD',
        personalDataRelation: {
          addresses: {
            some: {
              location: locationId
            }
          }
        }
      },
      include: {
        personalDataRelation: {
          include: {
            addresses: {
              include: {
                locationRelation: true
              }
            }
          }
        }
      }
    })

    if (!existingLeader) {
      return null
    }

    return {
      id: existingLeader.id,
      fullName: existingLeader.personalDataRelation?.fullName || 'Desconocido',
      locationName: existingLeader.personalDataRelation?.addresses[0]?.locationRelation?.name || 'Desconocida'
    }
  }

  /**
   * Obtiene todos los líderes con sus cumpleaños
   * Ordenados por proximidad del próximo cumpleaños
   */
  async getLeaderBirthdays(routeId?: string) {
    const leaders = await this.prisma.employee.findMany({
      where: {
        type: 'LEAD',
        ...(routeId && {
          routes: {
            some: { id: routeId }
          }
        })
      },
      include: {
        personalDataRelation: {
          include: {
            phones: true,
            addresses: {
              include: {
                locationRelation: true
              }
            }
          }
        },
        routes: true
      }
    })

    const today = new Date()
    today.setHours(0, 0, 0, 0) // Normalize to start of day
    const currentYear = today.getFullYear()

    // Función para calcular días hasta el próximo cumpleaños
    const getDaysUntilBirthday = (birthDate: Date | null): number => {
      if (!birthDate) return 9999 // Sin fecha al final

      const birthday = new Date(birthDate)
      // Use UTC methods to avoid timezone issues (birthDate stored as UTC midnight)
      const thisYearBirthday = new Date(currentYear, birthday.getUTCMonth(), birthday.getUTCDate())
      thisYearBirthday.setHours(0, 0, 0, 0)

      // Si ya pasó este año, usar el del próximo año
      if (thisYearBirthday < today) {
        thisYearBirthday.setFullYear(currentYear + 1)
      }

      const diffTime = thisYearBirthday.getTime() - today.getTime()
      return Math.round(diffTime / (1000 * 60 * 60 * 24))
    }

    // Transformar y ordenar
    const leaderBirthdays = leaders
      .map((leader) => {
        const personalData = leader.personalDataRelation
        const location = personalData?.addresses[0]?.locationRelation
        const route = leader.routes[0]

        return {
          id: leader.id,
          fullName: personalData?.fullName || 'Sin nombre',
          birthDate: personalData?.birthDate || null,
          phone: personalData?.phones[0]?.number || null,
          locationName: location?.name || 'Sin localidad',
          routeId: route?.id || '',
          routeName: route?.name || 'Sin ruta',
          daysUntilBirthday: getDaysUntilBirthday(personalData?.birthDate || null),
        }
      })
      .sort((a, b) => a.daysUntilBirthday - b.daysUntilBirthday)

    return leaderBirthdays
  }
}
