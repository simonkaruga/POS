import { Controller, Post, Body, UseGuards, Req, Get, Redirect, Delete, Param, UnauthorizedException, BadRequestException, ServiceUnavailableException, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { JwtAuthGuard, Public } from './jwt-auth.guard';
import { SkipSubscriptionCheck } from './subscription.guard';
import type { Request } from 'express';
import type { AuthUser } from './auth.service';
import { frontendUrl } from '../common/app-urls';
import { DeviceLoginService } from './device-login.service';

interface LoginDto {
  email: string;
  password: string;
  totpCode?: string;
}

interface PinLoginDto {
  pin: string;
  businessId: string;
  storeId?: string;
  userId?: string; // optional: scope PIN check to a specific user
}

interface RegisterDto {
  name: string;
  email: string;
  password: string;
  businessName: string;
  affiliateCode?: string;
}

@SkipSubscriptionCheck()
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService, private deviceLogin: DeviceLoginService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.loginWithPassword(dto.email, dto.password, dto.totpCode);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('login/pin')
  async loginPin(@Body() dto: PinLoginDto) {
    return this.authService.loginWithPin(dto.pin, dto.businessId, dto.storeId, dto.userId);
  }

  // ─── Fingerprint / face unlock for the native apps ──────────────────────────

  @UseGuards(JwtAuthGuard)
  @SkipSubscriptionCheck()
  @Post('device-token')
  async enrolDevice(@Body() dto: { deviceName?: string }, @Req() req: Request & { user: AuthUser }) {
    return this.deviceLogin.enrol(req.user.id, dto?.deviceName);
  }

  @Public()
  @SkipSubscriptionCheck()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login/device')
  async loginDevice(@Body() dto: { deviceToken: string }) {
    return this.deviceLogin.login(dto?.deviceToken);
  }

  @UseGuards(JwtAuthGuard)
  @SkipSubscriptionCheck()
  @Post('device-token/revoke')
  async revokeDevice(@Body() dto: { deviceToken?: string }, @Req() req: Request & { user: AuthUser }) {
    return this.deviceLogin.revoke(req.user.id, dto?.deviceToken);
  }

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.registerOwner(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('refresh')
  async refresh(@Req() req: Request & { user: AuthUser }) {
    return this.authService.refreshToken(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('totp/setup')
  async setupTotp(@Req() req: Request & { user: AuthUser }) {
    return this.authService.setupTotp(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Req() req: Request & { user: AuthUser }) {
    return req.user;
  }

  // ─── Google OAuth ──────────────────────────────────────────────────────────

  /** Browser navigates here to start Google OAuth consent flow. */
  @SkipThrottle()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth() {
    // passport initiates redirect — no body needed
  }

  /**
   * Mobile apps open this URL in the system browser to start Google OAuth.
   * After auth, the callback redirects to the app's deep link scheme.
   * e.g. GET /auth/google/mobile?scheme=faida-pos
   */
  @Public()
  @SkipThrottle()
  @Get('google/mobile')
  mobileGoogleAuth(@Query('scheme') scheme: string, @Res() res: Response) {
    const clientId  = process.env.GOOGLE_CLIENT_ID ?? '';
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL ?? '';
    const safeScheme = /^[a-zA-Z0-9\-]+$/.test(scheme ?? '') ? scheme : 'faida-pos';
    // Pass scheme via state so the callback can redirect to the right deep link
    const state = Buffer.from(JSON.stringify({ mobile: 1, scheme: safeScheme })).toString('base64url');
    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  callbackUrl,
      response_type: 'code',
      scope:         'openid email profile',
      state,
      access_type:   'offline',
      prompt:        'select_account',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  }

  /** Google redirects back here after user grants permission. */
  @SkipThrottle()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @Redirect()
  async googleCallback(
    @Req() req: Request & { user: { accessToken: string; user: AuthUser } },
    @Query('state') rawState: string,
  ) {
    const { accessToken, user } = req.user;

    // Check for mobile deep-link redirect
    if (rawState) {
      try {
        const state = JSON.parse(Buffer.from(rawState, 'base64url').toString()) as { mobile?: number; scheme?: string };
        if (state.mobile && state.scheme) {
          const scheme = /^[a-zA-Z0-9\-]+$/.test(state.scheme) ? state.scheme : 'faida-pos';
          return {
            url: `${scheme}://auth/google?token=${accessToken}&id=${user.id}&businessId=${user.businessId}&role=${user.role}&name=${encodeURIComponent(user.name)}&email=${encodeURIComponent(user.email ?? '')}`,
          };
        }
      } catch { /* ignore malformed state */ }
    }

    const frontendBase = frontendUrl();
    // Redirect to frontend with token in query string; frontend stores it in sessionStorage
    return {
      url: `${frontendBase}/?oauth_token=${accessToken}&oauth_businessId=${user.businessId}&oauth_role=${user.role}&oauth_name=${encodeURIComponent(user.name)}&oauth_id=${user.id}`,
    };
  }

  /**
   * Frontend-initiated Google OAuth (used by @react-oauth/google).
   * Receives the Google access token from the browser, verifies it with Google,
   * and returns a Faida JWT.
   */
  @Public()
  @SkipThrottle()
  @Post('google/token')
  async googleToken(@Body() body: { accessToken: string }) {
    const res = await fetch(
      `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${body.accessToken}`,
    );
    if (!res.ok) throw new UnauthorizedException('Invalid Google access token');
    const profile = await res.json() as {
      sub: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    return this.authService.loginWithGoogle({
      googleId: profile.sub,
      email: profile.email ?? null,
      name: profile.name ?? 'Google User',
      avatarUrl: profile.picture ?? null,
    });
  }

  /**
   * Desktop (Tauri) Google sign-in. The app opens Google in the system browser and
   * catches the authorization code on a loopback address, then asks this endpoint
   * for the OAuth client id (public) before building the consent URL.
   */
  @Public()
  @SkipThrottle()
  @Get('google/desktop-config')
  desktopGoogleConfig() {
    const clientId = process.env.GOOGLE_DESKTOP_CLIENT_ID ?? '';
    if (!clientId) throw new ServiceUnavailableException('Google sign-in is not configured for the desktop app');
    return { clientId };
  }

  /**
   * Swaps the authorization code (+ PKCE verifier) from the desktop loopback flow for
   * a Google access token. Google's desktop client type needs the client secret for
   * this call, so it happens here rather than inside the installed app. The returned
   * token is then used with google/token or google/register like any other.
   */
  @Public()
  @Post('google/desktop-exchange')
  async desktopGoogleExchange(
    @Body() body: { code: string; codeVerifier: string; redirectUri: string },
  ) {
    const clientId = process.env.GOOGLE_DESKTOP_CLIENT_ID ?? '';
    const clientSecret = process.env.GOOGLE_DESKTOP_CLIENT_SECRET ?? '';
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException('Google sign-in is not configured for the desktop app');
    }
    if (!body?.code || !body.codeVerifier || !/^http:\/\/127\.0\.0\.1:\d+$/.test(body.redirectUri ?? '')) {
      throw new BadRequestException('Invalid Google sign-in request');
    }
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: body.code,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: body.codeVerifier,
        redirect_uri: body.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    const data = await res.json() as { access_token?: string };
    if (!res.ok || !data.access_token) throw new UnauthorizedException('Google sign-in failed');
    return { accessToken: data.access_token };
  }

  @Public()
  @SkipThrottle()
  @Post('google/register')
  async googleRegister(@Body() body: { accessToken: string; businessName: string }) {
    if (!body.businessName?.trim()) throw new UnauthorizedException('Business name is required');
    const res = await fetch(
      `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${body.accessToken}`,
    );
    if (!res.ok) throw new UnauthorizedException('Invalid Google access token');
    const profile = await res.json() as {
      sub: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    return this.authService.registerWithGoogle({
      googleId: profile.sub,
      email: profile.email ?? null,
      name: profile.name ?? 'Google User',
      avatarUrl: profile.picture ?? null,
      businessName: body.businessName.trim(),
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('manager-pin/verify')
  async verifyManagerPin(
    @Body() dto: { pin: string; businessId: string },
  ) {
    return this.authService.verifyManagerPin(dto.pin, dto.businessId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(@Req() req: Request & { user: AuthUser }, @Body() body: { currentPassword: string; newPassword: string }) {
    return this.authService.changePassword(req.user.id, body.currentPassword, body.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async getSessions(@Req() req: Request & { user: AuthUser }) {
    return this.authService.getSessions(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  async revokeSession(@Req() req: Request & { user: AuthUser }, @Param('id') id: string) {
    return this.authService.revokeSession(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions')
  async revokeAllSessions(@Req() req: Request & { user: AuthUser }) {
    return this.authService.revokeAllSessions(req.user.id);
  }

  // ─── Forgot / Reset password (public — no JWT needed) ─────────────────────

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body.email);
  }

  @Public()
  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; newPassword: string }) {
    return this.authService.resetPasswordWithToken(body.token, body.newPassword);
  }
}
