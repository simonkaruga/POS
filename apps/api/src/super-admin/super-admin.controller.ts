import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, OnModuleInit,
  Res, Req,
} from '@nestjs/common';
import { Response, Request } from 'express';

import { Public } from '../auth/jwt-auth.guard';
import { SuperAdminService } from './super-admin.service';
import { SuperAdminAuthGuard } from './super-admin-auth.guard';
import { SkipSubscriptionCheck } from '../auth/subscription.guard';
import { SecretsRotationService } from '../security/secrets-rotation.service';

@Public()
@Controller('super-admin')
@SkipSubscriptionCheck()
export class SuperAdminController implements OnModuleInit {
  constructor(
    private service: SuperAdminService,
    private rotation: SecretsRotationService,
  ) {}

  async onModuleInit() {
    await this.service.ensureDefaultAdmin();
  }

  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.service.login(body.email, body.password);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Get('stats')
  getStats() {
    return this.service.getPlatformStats();
  }

  @UseGuards(SuperAdminAuthGuard)
  @Get('businesses')
  listBusinesses(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
  ) {
    return this.service.listBusinesses(parseInt(page), parseInt(limit), search);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Get('businesses/recent')
  recentSignups(@Query('days') days = '30') {
    return this.service.getRecentSignups(parseInt(days));
  }

  @UseGuards(SuperAdminAuthGuard)
  @Patch('businesses/:id/subscription')
  updateSubscription(
    @Param('id') id: string,
    @Body()
    body: {
      subscriptionStatus?: string;
      subscriptionTier?: string;
      planName?: string;
      // null clears the trial date, which is what activating a paid or gifted plan
      // must do. Previously a null was coerced to undefined and quietly ignored,
      // leaving a granted account still carrying a trial expiry.
      trialEndsAt?: string | null;
      isComped?: boolean;
      compedReason?: string | null;
    },
  ) {
    return this.service.updateBusinessSubscription(id, {
      ...body,
      trialEndsAt:
        body.trialEndsAt === undefined
          ? undefined
          : body.trialEndsAt === null
            ? null
            : new Date(body.trialEndsAt),
    });
  }

  @UseGuards(SuperAdminAuthGuard)
  @Post('businesses/:id/impersonate')
  impersonate(@Param('id') id: string) {
    return this.service.impersonate(id);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Get('license-keys')
  listKeys(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.service.listLicenseKeys(parseInt(page), parseInt(limit));
  }

  @UseGuards(SuperAdminAuthGuard)
  @Post('license-keys')
  createKey(@Body() body: { tier: string; expiresAt?: string }) {
    return this.service.createLicenseKey({
      tier: body.tier,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
  }

  /** Free the key from its computer so it can be activated on a replacement. */
  @UseGuards(SuperAdminAuthGuard)
  @Patch('license-keys/:id/release')
  releaseKey(@Param('id') id: string) {
    return this.service.releaseLicenseKey(id);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Patch('license-keys/:id/revoke')
  revokeKey(@Param('id') id: string) {
    return this.service.revokeLicenseKey(id);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Post('license-keys/:id/resend')
  resendKey(@Param('id') id: string) {
    return this.service.resendLicenseKey(id);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Post('license-keys/:id/regenerate')
  regenerateKey(@Param('id') id: string) {
    return this.service.regenerateLicenseKey(id);
  }

  // ── Health Dashboard ──────────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('health')
  getHealth() {
    return this.service.getSystemHealth();
  }

  // ── Business Support View ─────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('businesses/:id/data')
  getBusinessData(@Param('id') id: string) {
    return this.service.getBusinessData(id);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Get('businesses/:id/users')
  getBusinessUsers(@Param('id') id: string) {
    return this.service.getBusinessUsers(id);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Get('users')
  listAllUsers(
    @Query('page') page = '1',
    @Query('limit') limit = '30',
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('businessName') businessName?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    return this.service.listAllUsers(parseInt(page), parseInt(limit), search, role, businessName, sortBy, sortDir);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Delete('users/:userId')
  deleteUser(@Param('userId') userId: string) {
    return this.service.deleteUser(userId);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Delete('businesses/:id')
  deleteBusiness(@Param('id') id: string) {
    return this.service.deleteBusiness(id);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Post('users/:userId/reset-password')
  resetUserPassword(@Param('userId') userId: string) {
    return this.service.resetUserPassword(userId);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Post('users/:userId/unlock')
  unlockUser(@Param('userId') userId: string) {
    return this.service.unlockUser(userId);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Patch('users/:userId')
  updateUser(
    @Param('userId') userId: string,
    @Body() body: { name?: string; role?: string; email?: string },
  ) {
    return this.service.updateUser(userId, body);
  }

  // ── Force Update ──────────────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Post('force-update')
  forceUpdate(
    @Body() body: { version: string; message: string; isRequired?: boolean },
  ) {
    return this.service.triggerForceUpdate(body.version, body.message, body.isRequired);
  }

  /** Public — no auth required. Called by clients to check if an update is pending. */
  @Get('update-check')
  updateCheck() {
    return this.service.checkForUpdate();
  }

  // ── Referrals ─────────────────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('referrals')
  listReferrals(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.service.listReferrals(parseInt(page), parseInt(limit));
  }

  // ── Secrets Rotation ──────────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Post('rotate-encryption-key')
  rotateEncryptionKey(@Body() body: { oldKey: string; newKey: string }) {
    return this.rotation.rotateEncryptionKey(body.oldKey, body.newKey);
  }

  // ── Churn Analytics ───────────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('analytics/churn')
  getChurnAnalytics(
    @Query('from') from?: string,
    @Query('to')   to?:   string,
  ) {
    return this.service.getChurnAnalytics(from, to);
  }

  // ── Trials Expiring Soon ──────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('analytics/trials-expiring')
  getTrialsExpiringSoon(@Query('days') days = '7') {
    return this.service.getTrialsExpiringSoon(parseInt(days));
  }

  // ── Dunning List ──────────────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('analytics/dunning')
  getDunningList() {
    return this.service.getDunningList();
  }

  // ── Alert Feed ────────────────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('alerts')
  getAlertFeed() {
    return this.service.getAlertFeed();
  }

  // ── Collected Revenue (Paystack KES) ──────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('analytics/collected-revenue')
  getCollectedRevenue() {
    return this.service.getCollectedRevenueCents();
  }

  @UseGuards(SuperAdminAuthGuard)
  @Post('businesses/:id/cancel')
  cancelBusiness(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: Request,
  ) {
    this.service.logAction((req as any).superAdmin?.email, 'cancel_subscription', id, 'Business', { reason: body.reason }, req.ip);
    return this.service.cancelBusinessSubscription(id, body.reason);
  }

  // ── Cohort Analysis ───────────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('analytics/cohort')
  getCohortAnalysis() {
    return this.service.getCohortAnalysis();
  }

  // ── LTV ───────────────────────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('analytics/ltv')
  getBusinessLTV(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('sortBy') sortBy: 'ltv' | 'gmv' | 'name' = 'ltv',
  ) {
    return this.service.getBusinessLTV(parseInt(page), parseInt(limit), sortBy);
  }

  // ── Bulk Subscription Changes ─────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Post('businesses/bulk-update')
  bulkUpdateSubscriptions(
    @Body() body: { businessIds: string[]; subscriptionStatus?: string; subscriptionTier?: string; trialDays?: number },
    @Req() req: Request,
  ) {
    this.service.logAction((req as any).superAdmin?.email, 'bulk_update_subscriptions', undefined, 'Business', body, req.ip);
    const { businessIds, ...data } = body;
    return this.service.bulkUpdateSubscriptions(businessIds, data);
  }

  // ── IP Whitelist ──────────────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('ip-whitelist')
  getIpWhitelist() {
    return this.service.getIpWhitelist();
  }

  @UseGuards(SuperAdminAuthGuard)
  @Post('ip-whitelist')
  addIp(@Body() body: { ip: string; label?: string }, @Req() req: Request) {
    return this.service.addIpToWhitelist(body.ip, body.label, (req as any).superAdmin?.email);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Delete('ip-whitelist/:id')
  removeIp(@Param('id') id: string) {
    return this.service.removeIpFromWhitelist(id);
  }

  // ── Webhook Management ────────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('webhooks')
  listWebhooks(@Query('page') page = '1', @Query('limit') limit = '30') {
    return this.service.listAllWebhooks(parseInt(page), parseInt(limit));
  }

  @UseGuards(SuperAdminAuthGuard)
  @Post('webhooks/:id/retry')
  retryWebhook(@Param('id') id: string) {
    return this.service.retryWebhook(id);
  }

  @UseGuards(SuperAdminAuthGuard)
  @Patch('webhooks/:id/toggle')
  toggleWebhook(@Param('id') id: string, @Body() body: { isActive: boolean }) {
    return this.service.toggleWebhook(id, body.isActive);
  }

  // ── Revenue Export ────────────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('export/revenue-csv')
  async exportRevenueCsv(@Res() res: Response) {
    const csv = await this.service.exportRevenueCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="faida-revenue-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  }

  // ── Paystack Revenue ──────────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('analytics/paystack-revenue')
  getPaystackRevenue() {
    return this.service.getPaystackRevenue();
  }

  // ── Per-Business Audit Log ────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('businesses/:id/audit-log')
  getBusinessAuditLog(
    @Param('id') id: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.service.getBusinessAuditLogs(id, parseInt(page), parseInt(limit));
  }

  // ── Super-Admin Audit Log ─────────────────────────────────────────────────

  @UseGuards(SuperAdminAuthGuard)
  @Get('audit-log')
  getSuperAdminAuditLog(@Query('page') page = '1', @Query('limit') limit = '50') {
    return this.service.getSuperAdminAuditLogs(parseInt(page), parseInt(limit));
  }
}
