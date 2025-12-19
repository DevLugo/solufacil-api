import type { GraphQLContext } from '@solufacil/graphql-schema'

interface PersonalDataParent {
  personalData: string | null
  personalDataRelation?: { id?: string | null } | null | unknown
}

/**
 * Shared resolver logic for personalData fields
 * Handles null checks and returns null for employees without valid personal data
 */
export async function resolvePersonalData(
  parent: PersonalDataParent,
  context: GraphQLContext
) {
  // If no personalData foreign key, return null
  if (!parent.personalData) {
    return null
  }

  // If personalDataRelation is already included, return it with id
  if (parent.personalDataRelation) {
    // Type guard: check if it's an object with id property
    const relation = parent.personalDataRelation as { id?: string | null }
    // If the relation object has no id, add it from parent.personalData
    if (!relation.id) {
      return {
        ...parent.personalDataRelation,
        id: parent.personalData,
      }
    }
    return parent.personalDataRelation
  }

  // Otherwise fetch from database
  return context.prisma.personalData.findUnique({
    where: { id: parent.personalData },
    include: {
      phones: true,
      addresses: {
        include: {
          locationRelation: {
            include: {
              municipalityRelation: {
                include: {
                  stateRelation: true,
                },
              },
            },
          },
        },
      },
    },
  })
}
