import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@apollo/server/express4'
import { graphqlUploadExpress } from 'graphql-upload-minimal'
import { typeDefs } from '@solufacil/graphql-schema'
import { resolvers } from './resolvers'
import { createContext } from './context'
import { prisma } from '@solufacil/database'
import { ClientHistoryService } from './services/ClientHistoryService'
import { PdfService } from './services/PdfService'
import { ListadoPDFService } from './services/ListadoPDFService'
import { PdfExportService } from './services/PdfExportService'
import { BadDebtPDFService } from './services/BadDebtPDFService'
import { LeaderBirthdayPDFService } from './services/LeaderBirthdayPDFService'
import jwt from 'jsonwebtoken'

async function startServer() {
  const app = express()

  // Apply global middleware
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))

  // CORS configuration
  const corsOptions = {
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      process.env.CORS_ORIGIN,
    ].filter(Boolean) as string[],
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'apollo-require-preflight',
      'x-apollo-operation-name',
    ],
  }

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    introspection: true, // Enable introspection for GraphQL Playground
    csrfPrevention: false, // Disable CSRF prevention to allow GraphQL Playground access
  })

  await server.start()

  // Setup middleware for /graphql endpoint
  app.use('/graphql', cors(corsOptions))
  app.use('/graphql', express.json({ limit: '10mb' }))
  app.use('/graphql', express.urlencoded({ extended: true }))
  // Ensure req.body is always defined (Apollo Server v4 requirement)
  app.use('/graphql', (req, res, next) => {
    if (!req.body) {
      req.body = {}
    }
    next()
  })
  app.use('/graphql', (req, res, next) => {
    // Only apply graphqlUploadExpress for POST requests with multipart
    if (req.method === 'POST' && req.is('multipart/form-data')) {
      return graphqlUploadExpress({ maxFileSize: 10000000, maxFiles: 10 })(req, res, next)
    }
    next()
  })
  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: createContext,
    }) as unknown as express.RequestHandler
  )

  // PDF Export endpoints
  const clientHistoryService = new ClientHistoryService(prisma)
  const pdfService = new PdfService()
  const pdfExportService = new PdfExportService(prisma)
  const listadoPDFService = new ListadoPDFService(prisma)
  const badDebtPDFService = new BadDebtPDFService(prisma)
  const leaderBirthdayPDFService = new LeaderBirthdayPDFService(prisma)

  // Handle preflight OPTIONS request for PDF export
  app.options('/api/export-client-history-pdf', cors(corsOptions))

  app.post(
    '/api/export-client-history-pdf',
    cors(corsOptions),
    express.json(),
    async (req, res) => {
      try {
        const { clientId, detailed = false } = req.body

        console.log('📄 Generando PDF del historial del cliente')
        console.log('   Cliente ID:', clientId)
        console.log('   Modo:', detailed ? 'Detallado' : 'Resumen')

        if (!clientId) {
          res.status(400).json({ error: 'clientId is required' })
          return
        }

        const pdfBuffer = await pdfExportService.generateClientHistoryPDF(clientId, detailed)

        const filename = `historial-cliente-${clientId.slice(0, 8)}-${detailed ? 'detallado' : 'resumen'}.pdf`

        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
        res.send(pdfBuffer)

        console.log('✅ PDF generado exitosamente')
      } catch (error) {
        console.error('❌ Error al generar PDF:', error)
        res.status(500).json({
          error: 'Failed to generate PDF',
          message: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
  )

  // Generar Listados endpoint
  app.get(
    '/api/generar-listados',
    cors(corsOptions),
    async (req, res) => {
      try {
        const { localityId, routeId, localityName, routeName, leaderName, leaderId, weekMode } = req.query

        if (!localityId || !routeId || !localityName || !routeName) {
          res.status(400).json({
            error: 'Missing required parameters: localityId, routeId, localityName, routeName'
          })
          return
        }

        const pdfBuffer = await listadoPDFService.generateListadoPDF({
          localityId: localityId as string,
          routeId: routeId as string,
          localityName: localityName as string,
          routeName: routeName as string,
          leaderName: (leaderName as string) || 'Sin asignar',
          leaderId: leaderId as string,
          weekMode: (weekMode as string) === 'current' ? 'current' : 'next'
        })

        // Generar nombre de archivo
        const localitySlug = (localityName as string).replace(/\s+/g, '_').toLowerCase()
        const currentDate = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' })
        const currentMonthName = new Date().toLocaleDateString('es-MX', { month: 'long' })

        // Calcular número de semana del mes
        const today = new Date()
        const dayOfMonth = today.getDate()
        const weekNumberInMonth = Math.ceil(dayOfMonth / 7)
        const weekNumber = (weekMode as string) === 'next' ? weekNumberInMonth + 1 : weekNumberInMonth

        const filename = `listado_${localitySlug}_semana_${weekNumber}_${currentMonthName}_${currentDate}.pdf`

        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
        res.send(pdfBuffer)
      } catch (error) {
        console.error('Error generating listado PDF:', error)
        res.status(500).json({ error: 'Failed to generate PDF' })
      }
    }
  )

  // Bad Debt Clients PDF export endpoint
  app.options('/api/export-bad-debt-pdf', cors(corsOptions))

  app.get(
    '/api/export-bad-debt-pdf',
    cors(corsOptions),
    async (req, res) => {
      try {
        const { routeId, locationId, routeName, locationName } = req.query

        console.log('📄 Generando PDF de clientes morosos')
        console.log('   Ruta:', routeName || 'Todas')
        console.log('   Localidad:', locationName || 'Todas')

        const pdfBuffer = await badDebtPDFService.generatePDF({
          routeId: routeId as string | undefined,
          locationId: locationId as string | undefined,
          routeName: routeName as string | undefined,
          locationName: locationName as string | undefined,
        })

        // Generate filename
        const dateStr = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '-')
        let filename = `clientes_morosos_${dateStr}`
        if (routeName) filename += `_${(routeName as string).replace(/\s+/g, '_').toLowerCase()}`
        if (locationName) filename += `_${(locationName as string).replace(/\s+/g, '_').toLowerCase()}`
        filename += '.pdf'

        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
        res.send(pdfBuffer)

        console.log('✅ PDF de clientes morosos generado exitosamente')
      } catch (error) {
        console.error('❌ Error al generar PDF de clientes morosos:', error)
        res.status(500).json({
          error: 'Failed to generate PDF',
          message: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
  )

  // Leader Birthdays PDF export endpoint
  app.options('/api/export-leader-birthdays-pdf', cors(corsOptions))

  app.get(
    '/api/export-leader-birthdays-pdf',
    cors(corsOptions),
    async (req, res) => {
      try {
        const { routeId, routeName } = req.query

        console.log('🎂 Generando PDF de cumpleaños de líderes')
        console.log('   Ruta:', routeName || 'Todas')

        const pdfBuffer = await leaderBirthdayPDFService.generatePDF({
          routeId: routeId as string | undefined,
          routeName: routeName as string | undefined,
        })

        // Generate filename
        const dateStr = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '-')
        let filename = `cumpleanos_lideres_${dateStr}`
        if (routeName) filename += `_${(routeName as string).replace(/\s+/g, '_').toLowerCase()}`
        filename += '.pdf'

        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
        res.send(pdfBuffer)

        console.log('✅ PDF de cumpleaños de líderes generado exitosamente')
      } catch (error) {
        console.error('❌ Error al generar PDF de cumpleaños de líderes:', error)
        res.status(500).json({
          error: 'Failed to generate PDF',
          message: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
  )

  // ========================================
  // PowerSync Authentication Endpoints
  // ========================================

  const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me'

  // PowerSync credential endpoint - validates JWT and returns PowerSync credentials
  app.get('/api/powersync/credentials', cors(), async (req, res) => {
    try {
      const authHeader = req.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid authorization header' })
        return
      }

      const token = authHeader.split(' ')[1]

      // Verify the JWT
      const payload = jwt.verify(token, JWT_SECRET) as {
        userId: string
        email: string
        role: string
      }

      // Return PowerSync credentials
      // PowerSync will use these to authenticate the sync connection
      res.json({
        endpoint: process.env.POWERSYNC_URL || 'http://localhost:8080',
        token: token, // Pass through the same JWT
        user_id: payload.userId,
        // Optional: expiration time
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
      })
    } catch (error) {
      console.error('PowerSync credential error:', error)
      res.status(401).json({ error: 'Invalid token' })
    }
  })

  // PowerSync JWKS endpoint (for JWT validation)
  // Since we use HS256, we provide the key directly to PowerSync via config
  app.get('/api/powersync/.well-known/jwks.json', cors(), (req, res) => {
    // For HS256, PowerSync needs the secret configured directly
    // This endpoint returns an empty JWKS since we use symmetric keys
    res.json({
      keys: [],
      // Note: For HS256 tokens, configure the secret in powersync.yaml
      // using client_auth.supabase_jwt_secret or similar
    })
  })

  // PowerSync token validation endpoint (alternative auth method)
  app.post('/api/powersync/auth', cors(), express.json(), async (req, res) => {
    try {
      const { token } = req.body

      if (!token) {
        res.status(401).json({ error: 'Token required' })
        return
      }

      // Verify the JWT
      const payload = jwt.verify(token, JWT_SECRET) as {
        userId: string
        email: string
        role: string
      }

      // Return user info for PowerSync
      res.json({
        user_id: payload.userId,
        email: payload.email,
        role: payload.role,
        // PowerSync bucket parameters (used in sync-rules.yaml)
        parameters: {
          user_id: payload.userId,
          role: payload.role,
        },
      })
    } catch (error) {
      console.error('PowerSync auth error:', error)
      res.status(401).json({ error: 'Invalid token' })
    }
  })

  // Health check for PowerSync
  app.get('/api/powersync/health', cors(), (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  const port = Number(process.env.PORT) || 4000

  app.listen(port, () => {
    console.log(`🚀 Apollo Server ready at http://localhost:${port}/graphql`)
    console.log(`📊 GraphQL Playground: http://localhost:${port}/graphql`)
    console.log(`🔄 PowerSync endpoints: http://localhost:${port}/api/powersync/*`)
    console.log(`🗄️  Database: Connected`)
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log(`🌐 CORS enabled for: ${corsOptions.origin.join(', ')}`)
  })
}

startServer().catch((error) => {
  console.error('❌ Failed to start server:', error)
  process.exit(1)
})
