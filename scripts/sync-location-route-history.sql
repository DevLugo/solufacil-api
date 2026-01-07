-- ============================================================
-- SYNC LocationRouteHistory usando lógica de dropdown /transacciones
-- Fuente: RouteRepository.findLocations()
-- ============================================================

-- Paso 0: Limpiar registros existentes
DELETE FROM "LocationRouteHistory";

-- Paso 1: Insertar desde Location.route (fuente primaria)
INSERT INTO "LocationRouteHistory" (
  "id",
  "locationId",
  "routeId",
  "startDate",
  "endDate",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  loc.id,
  loc.route,
  '2020-01-01'::timestamp,
  NULL::timestamp,
  NOW(),
  NOW()
FROM "Location" loc
WHERE loc.route IS NOT NULL;

-- Paso 2: Insertar desde Employee→Route (localidades faltantes)
-- Lógica: Employee.routes → PersonalData → Address → Location
INSERT INTO "LocationRouteHistory" (
  "id",
  "locationId",
  "routeId",
  "startDate",
  "endDate",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT ON (loc.id)
  gen_random_uuid()::text,
  loc.id,
  re."B",
  '2020-01-01'::timestamp,
  NULL::timestamp,
  NOW(),
  NOW()
FROM "_RouteEmployees" re
JOIN "Employee" e ON e.id = re."A"
JOIN "PersonalData" pd ON pd.id = e."personalData"
JOIN "Address" a ON a."personalData" = pd.id
JOIN "Location" loc ON loc.id = a.location
WHERE loc.id IS NOT NULL
  AND re."B" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "LocationRouteHistory" lrh
    WHERE lrh."locationId" = loc.id
  )
ORDER BY loc.id, e."createdAt" DESC;

-- Paso 3: Sincronizar Location.route con LocationRouteHistory
UPDATE "Location" loc
SET route = lrh."routeId"
FROM "LocationRouteHistory" lrh
WHERE lrh."locationId" = loc.id
  AND (loc.route IS NULL OR loc.route != lrh."routeId");

-- Verificación
SELECT
  r.name as route_name,
  COUNT(lrh.id) as location_count
FROM "LocationRouteHistory" lrh
JOIN "Route" r ON r.id = lrh."routeId"
GROUP BY r.name
ORDER BY r.name;
