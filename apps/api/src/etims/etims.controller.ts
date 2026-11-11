import { Controller, Post, Get, Patch, Body, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.service';
import { EtimsService } from './etims.service';

type AuthedRequest = Request & { user: AuthUser };

@Controller('etims')
export class EtimsController {
  constructor(private etimsService: EtimsService) {}

  // ─── Sale lifecycle ───────────────────────────────────────────────────────

  // A sale id carries no businessId for the tenant guard to check, so each of these confirms the sale is the caller's.
  @Post('submit/:saleId')
  async submitSale(@Param('saleId') saleId: string, @Req() req: AuthedRequest) {
    await this.etimsService.assertSaleOwned(saleId, req.user.businessId);
    return this.etimsService.submitSale(saleId);
  }

  @Post('void/:saleId')
  async voidSale(@Param('saleId') saleId: string, @Body('reason') reason: string, @Req() req: AuthedRequest) {
    await this.etimsService.assertSaleOwned(saleId, req.user.businessId);
    return this.etimsService.voidSale(saleId, reason);
  }

  @Post('amend/:saleId')
  async submitAmendment(@Param('saleId') saleId: string, @Req() req: AuthedRequest) {
    await this.etimsService.assertSaleOwned(saleId, req.user.businessId);
    return this.etimsService.submitAmendment(saleId);
  }

  // ─── The owner's eTIMS screen ─────────────────────────────────────────────

  @Get('status')
  status(@Req() req: AuthedRequest) {
    return this.etimsService.status(req.user.businessId);
  }

  @Get('attention')
  attention(@Req() req: AuthedRequest) {
    return this.etimsService.attention(req.user.businessId);
  }

  @Post('sales/:saleId/retry')
  retrySale(@Param('saleId') saleId: string, @Req() req: AuthedRequest) {
    return this.etimsService.retrySale(saleId, req.user.businessId);
  }

  @Get('item-classes')
  searchItemClasses(@Query('q') q: string) {
    return this.etimsService.searchItemClasses(q);
  }

  @Post('item-classes/sync')
  syncItemClasses(@Req() req: AuthedRequest) {
    return this.etimsService.syncItemClasses(req.user.businessId);
  }

  @Patch('items')
  setItemsKra(@Body() body: { itemIds: string[]; itemClsCd?: string; qtyUnitCd?: string; pkgUnitCd?: string }, @Req() req: AuthedRequest) {
    const { itemIds, ...data } = body;
    return this.etimsService.setItemsKra(req.user.businessId, Array.isArray(itemIds) ? itemIds : [], data);
  }

  @Patch('default-item-class')
  setDefaultItemClass(@Body('itemClsCd') itemClsCd: string | null, @Req() req: AuthedRequest) {
    return this.etimsService.setDefaultItemClass(req.user.businessId, itemClsCd);
  }

  @Get('calls')
  recentCalls(@Query('limit') limit: string, @Req() req: AuthedRequest) {
    return this.etimsService.recentCalls(req.user.businessId, Number(limit) || 50);
  }

  @Post('stock/report')
  reportStockNow(@Req() req: AuthedRequest) {
    return this.etimsService.reportStockNow(req.user.businessId);
  }

  @Get('stock-status')
  getStockStatus(@Query('businessId') businessId: string) {
    return this.etimsService.getStockStatus(businessId);
  }

  @Get('pending-count')
  getPendingCount(@Query('businessId') businessId: string) {
    return this.etimsService.getPendingCount(businessId);
  }

  @Post('batch-submit')
  batchSubmit(@Query('businessId') businessId: string) {
    return this.etimsService.batchSubmit(businessId);
  }

  // ─── Production onboarding ────────────────────────────────────────────────

  @Post('production-onboarding')
  initiateProductionOnboarding(@Body() body: {
    businessId: string;
    kraPin: string;
    /** The OSCU device serial number from the KRA eTIMS portal. */
    dvcSrlNo: string;
    /** The KRA branch id (00 = head office). */
    bhfId?: string;
    businessName: string;
    businessAddress: string;
    contactPerson: string;
    contactPhone: string;
    contactEmail: string;
    certificateFile?: string;
  }) {
    return this.etimsService.initiateProductionOnboarding(body);
  }

  @Post('switch-production/:businessId')
  switchToProductionMode(@Param('businessId') businessId: string) {
    return this.etimsService.switchToProductionMode(businessId);
  }

  // ─── iTax integration ─────────────────────────────────────────────────────

  @Post('enable-itax')
  enableItaxIntegration(@Body() body: { businessId: string; username: string; password: string; kraPin: string }) {
    const { businessId, ...credentials } = body;
    return this.etimsService.enableItaxIntegration(businessId, credentials);
  }

  // ─── VAT returns ──────────────────────────────────────────────────────────

  @Get('vat-return-data')
  getVatReturnData(@Query('businessId') businessId: string, @Query('period') period: string) {
    return this.etimsService.getVatReturnData(businessId, period);
  }

  @Post('submit-vat-return')
  submitVatReturn(@Body() body: {
    businessId: string;
    period: string;
    totalSales: number;
    totalPurchases: number;
    vatOnSales: number;
    vatOnPurchases: number;
    netVat: number;
  }) {
    return this.etimsService.submitVatReturn(body);
  }
}
