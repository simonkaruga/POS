-- KRA's item classification list, synced from /selectItemClsList.
CREATE TABLE "EtimsItemClass" (
    "itemClsCd" TEXT NOT NULL,
    "itemClsNm" TEXT NOT NULL,
    "itemClsLvl" INTEGER,
    "taxTyCd" TEXT,
    "useYn" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EtimsItemClass_pkey" PRIMARY KEY ("itemClsCd")
);

CREATE INDEX "EtimsItemClass_itemClsNm_idx" ON "EtimsItemClass"("itemClsNm");
