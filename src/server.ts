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

async function startServer() {
  const app = express()

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

  app.use(
    '/graphql',
    cors(corsOptions),
    express.json(),
    graphqlUploadExpress({ maxFileSize: 10000000, maxFiles: 10 }), // 10MB max, 10 files max
    expressMiddleware(server, {
      context: createContext,
    }) as unknown as express.RequestHandler
  )

  // PDF Export endpoints
  const clientHistoryService = new ClientHistoryService(prisma)
  const pdfService = new PdfService()
  const pdfExportService = new PdfExportService(prisma)
  const listadoPDFService = new ListadoPDFService(prisma)

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

  const port = Number(process.env.PORT) || 4000

  app.listen(port, () => {
    console.log(`🚀 Apollo Server ready at http://localhost:${port}/graphql`)
    console.log(`📊 GraphQL Playground: http://localhost:${port}/graphql`)
    console.log(`🗄️  Database: Connected`)
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log(`🌐 CORS enabled for: ${corsOptions.origin.join(', ')}`)
  })
}

startServer().catch((error) => {
  console.error('❌ Failed to start server:', error)
  process.exit(1)
})
