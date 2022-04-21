import { forwardRef, Module } from '@nestjs/common';
import {
  ClientOptions,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import { WebSocketPublisherModule } from 'src/websockets/web-socket-publisher-module';
import { ApiConfigService } from '../api-config/api.config.service';
import { CachingModule } from '../caching/caching.module';
import { PubSubListenerController } from './pub.sub.listener.controller';

@Module({
  imports: [forwardRef(() => CachingModule), WebSocketPublisherModule],
  controllers: [PubSubListenerController],
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
  ],
  exports: ['PUBSUB_SERVICE'],
})
export class PubSubListenerModule {}
