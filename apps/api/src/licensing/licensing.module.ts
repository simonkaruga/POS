import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LicenseAuthorityService } from './license-authority.service';
import { LicenseServerController } from './license-server.controller';
import { LicenseService } from './license.service';
import { LicenseController } from './license.controller';

/**
 * Licensing. On the Faida cloud server: the authority that issues licences to offline installations. On an offline
 * installation (FAIDA_EDITION=LOCAL): the service that holds the signed licence and keeps the business's plan in step.
 */
@Module({
  imports: [PrismaModule],
  providers: [LicenseAuthorityService, LicenseService],
  controllers: [LicenseServerController, LicenseController],
  exports: [LicenseAuthorityService, LicenseService],
})
export class LicensingModule {}
