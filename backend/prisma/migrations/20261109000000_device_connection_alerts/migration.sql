-- Device connection alerts (PRD FR-026) do not belong to a measurement and do
-- not carry a numeric value or direction. Allow those columns to be NULL while
-- keeping threshold alerts unchanged.

-- AlterEnum
ALTER TYPE "AlertParameter" ADD VALUE 'DEVICE_CONNECTION';

-- AlterTable
ALTER TABLE "alerts" ALTER COLUMN "measurement_id" DROP NOT NULL;
ALTER TABLE "alerts" ALTER COLUMN "value" DROP NOT NULL;
ALTER TABLE "alerts" ALTER COLUMN "direction" DROP NOT NULL;

-- CreateIndex (supports per-device notification feeds)
CREATE INDEX "alerts_device_id_created_at_idx" ON "alerts"("device_id", "created_at" DESC);
