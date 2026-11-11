-- KRA eTIMS OSCU: gapless KRA invoice / stock numbers, signed receipt details, item registration, stock reporting,
-- and a log of every call to KRA. Additive only: no existing column is changed.

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "etimsDefaultItemClsCd" TEXT,
ADD COLUMN     "etimsInvcSeq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "etimsItemSeq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "etimsLiveSince" TIMESTAMP(3),
ADD COLUMN     "etimsSarSeq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "etimsError" TEXT,
ADD COLUMN     "etimsReportedAt" TIMESTAMP(3),
ADD COLUMN     "etimsSarNo" INTEGER;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "etimsItemCd" TEXT,
ADD COLUMN     "etimsPkgUnitCd" TEXT,
ADD COLUMN     "etimsQtyUnitCd" TEXT,
ADD COLUMN     "etimsRegisterError" TEXT,
ADD COLUMN     "etimsRegisteredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Return" ADD COLUMN     "etimsCreditNoteError" TEXT,
ADD COLUMN     "etimsCreditNoteInvcNo" INTEGER,
ADD COLUMN     "etimsCreditNoteSign" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "etimsAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "etimsIntrlData" TEXT,
ADD COLUMN     "etimsInvcNo" INTEGER,
ADD COLUMN     "etimsLastError" TEXT,
ADD COLUMN     "etimsNeedsAttention" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "etimsRcptSign" TEXT,
ADD COLUMN     "etimsSignedAt" TEXT;

-- Stock movements still to report to KRA are found by this index.
CREATE INDEX "InventoryMovement_etims_pending_idx" ON "InventoryMovement"("businessId", "etimsReportedAt", "createdAt");

-- CreateTable
CREATE TABLE "EtimsCallLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request" JSONB,
    "response" JSONB,
    "resultCd" TEXT,
    "ok" BOOLEAN NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EtimsCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EtimsCallLog_businessId_createdAt_idx" ON "EtimsCallLog"("businessId", "createdAt");
