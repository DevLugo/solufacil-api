-- CreateTable: LocationRouteHistory
-- Permite rastrear a qué ruta pertenece cada localidad en cada fecha
CREATE TABLE "LocationRouteHistory" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationRouteHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique constraint para evitar asignaciones duplicadas
CREATE UNIQUE INDEX "LocationRouteHistory_locationId_startDate_key" ON "LocationRouteHistory"("locationId", "startDate");

-- CreateIndex: Para búsquedas por localidad y rango de fechas
CREATE INDEX "LocationRouteHistory_locationId_startDate_endDate_idx" ON "LocationRouteHistory"("locationId", "startDate", "endDate");

-- CreateIndex: Para búsquedas por ruta y rango de fechas
CREATE INDEX "LocationRouteHistory_routeId_startDate_endDate_idx" ON "LocationRouteHistory"("routeId", "startDate", "endDate");

-- AddForeignKey: Location
ALTER TABLE "LocationRouteHistory" ADD CONSTRAINT "LocationRouteHistory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Route
ALTER TABLE "LocationRouteHistory" ADD CONSTRAINT "LocationRouteHistory_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- MigrateData: Crear registros históricos basados en Location.route actual
-- Asumimos que la asignación actual ha estado vigente desde 2020-01-01
INSERT INTO "LocationRouteHistory" ("id", "locationId", "routeId", "startDate", "endDate", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    "id",
    "route",
    '2020-01-01'::timestamp,
    NULL,
    NOW(),
    NOW()
FROM "Location"
WHERE "route" IS NOT NULL;
