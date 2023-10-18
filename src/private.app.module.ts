import { Module } from '@nestjs/common';
import { RemoteCacheController } from './endpoints/caching/remote.cache.controller';
import { ApiMetricsController } from './common/metrics/api.metrics.controller';
import { HealthCheckController } from './endpoints/health-check/health.check.controller';
import { ProcessNftsPrivateController } from './endpoints/process-nfts/process.nfts.private.controller';
import { ProcessNftsModule } from './endpoints/process-nfts/process.nfts.module';
import { LoggingModule } from '@multiversx/sdk-nestjs-common';
import { DynamicModuleUtils } from './utils/dynamic.module.utils';
import { ApiMetricsModule } from './common/metrics/api.metrics.module';
import { SentryModule } from '@ntegral/nestjs-sentry';
import configuration from 'config/configuration';

@Module({
  imports: [
    LoggingModule,
    ProcessNftsModule,
    ApiMetricsModule,
    SentryModule.forRoot({
      debug: true,
      dsn: configuration().sentryDsn,
      logLevels: ['error'],
      environment: 'prod',
      tracesSampleRate: 1.0,
    }),
  ],
  providers: [
    DynamicModuleUtils.getNestJsApiConfigService(),
    DynamicModuleUtils.getPubSubService(),
  ],
  controllers: [
    ApiMetricsController,
    RemoteCacheController,
    HealthCheckController,
    ProcessNftsPrivateController,
  ],
})
export class PrivateAppModule {}
