import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheWarmerService } from './cache.warmer.service';
import { EndpointsServicesModule } from '../../endpoints/endpoints.services.module';
import { PluginModule } from 'src/plugins/plugin.module';
import { KeybaseModule } from 'src/common/keybase/keybase.module';
import { ApiConfigService } from 'src/common/api-config/api.config.service';
import {
  ClientOptions,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import { MexSettingsModule } from 'src/endpoints/transactions/transaction-action/recognizers/mex/mex.settings.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    EndpointsServicesModule,
    PluginModule,
    KeybaseModule,
    MexSettingsModule,
  ],
  providers: [
    {
      provide: 'PUBSUB_SERVICE',
      useFactory: (apiConfigService: ApiConfigService) => {
        const clientOptions: ClientOptions = {
          transport: Transport.REDIS,
          options: {
            url: `${apiConfigService.getRedisUrl()}`,
            retryDelay: 1000,
            retryAttempts: 10,
            retry_strategy: function (_: any) {
              return 1000;
            },
          },
        };

        return ClientProxyFactory.create(clientOptions);
      },
      inject: [ApiConfigService],
    },
    CacheWarmerService,
  ],
})
export class CacheWarmerModule {}
