import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PublicAppModule } from './public.app.module';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { ApiConfigService } from './common/api-config/api.config.service';
import { CachingService } from './common/caching/caching.service';
import { TokenAssetService } from './endpoints/tokens/token.asset.service';
import { CachingInterceptor } from './interceptors/caching.interceptor';
import { FieldsInterceptor } from './interceptors/fields.interceptor';
import { PrivateAppModule } from './private.app.module';
import { MetricsService } from './common/metrics/metrics.service';
import { CacheWarmerModule } from './crons/cache.warmer/cache.warmer.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger, NestInterceptor } from '@nestjs/common';
import * as bodyParser from 'body-parser';
import * as requestIp from 'request-ip';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { CleanupInterceptor } from './interceptors/cleanup.interceptor';
import { RedisClient } from 'redis';
import { ExtractInterceptor } from './interceptors/extract.interceptor';
import { JwtAuthenticateGuard } from './interceptors/access.interceptor';
import { TransactionProcessorModule } from './crons/transaction.processor/transaction.processor.module';
import { PubSubListenerModule } from './common/pubsub/pub.sub.listener.module';
import { ProtocolService } from './common/protocol/protocol.service';
import { PaginationInterceptor } from './interceptors/pagination.interceptor';
import { LogRequestsInterceptor } from './interceptors/log.requests.interceptor';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NftQueueModule } from './queue.worker/nft.worker/queue/nft.queue.module';
import configuration from 'config/configuration';
import { PluginService } from './common/plugins/plugin.service';
import { TransactionCompletedModule } from './crons/transaction.processor/transaction.completed.module';
import { SocketAdapter } from './websockets/socket-adapter';

async function bootstrap() {
  const conf = configuration();
  if (conf.flags?.useTracing === true) {
    require('dd-trace').init();
  }

  const publicApp = await NestFactory.create<NestExpressApplication>(
    PublicAppModule,
  );
  publicApp.use(bodyParser.json({ limit: '1mb' }));
  publicApp.use(requestIp.mw());
  publicApp.enableCors();
  publicApp.useLogger(publicApp.get(WINSTON_MODULE_NEST_PROVIDER));
  publicApp.disable('etag');
  publicApp.disable('x-powered-by');

  const apiConfigService = publicApp.get<ApiConfigService>(ApiConfigService);
  const cachingService = publicApp.get<CachingService>(CachingService);
  const httpAdapterHostService =
    publicApp.get<HttpAdapterHost>(HttpAdapterHost);
  const metricsService = publicApp.get<MetricsService>(MetricsService);
  const tokenAssetService = publicApp.get<TokenAssetService>(TokenAssetService);
  const protocolService = publicApp.get<ProtocolService>(ProtocolService);
  const pluginService = publicApp.get<PluginService>(PluginService);

  if (apiConfigService.getIsAuthActive()) {
    publicApp.useGlobalGuards(new JwtAuthenticateGuard(apiConfigService));
  }

  const httpServer = httpAdapterHostService.httpAdapter.getHttpServer();
  httpServer.keepAliveTimeout = apiConfigService.getServerTimeout();
  httpServer.headersTimeout = apiConfigService.getHeadersTimeout(); //`keepAliveTimeout + server's expected response time`

  await tokenAssetService.checkout();

  const globalInterceptors: NestInterceptor[] = [];
  globalInterceptors.push(new LoggingInterceptor(metricsService));

  if (apiConfigService.getUseRequestCachingFlag()) {
    globalInterceptors.push(
      new CachingInterceptor(
        cachingService,
        httpAdapterHostService,
        metricsService,
        protocolService,
      ),
    );
  }

  if (apiConfigService.getUseRequestLoggingFlag()) {
    globalInterceptors.push(new LogRequestsInterceptor(httpAdapterHostService));
  }

  globalInterceptors.push(new FieldsInterceptor());
  globalInterceptors.push(new ExtractInterceptor());
  globalInterceptors.push(new CleanupInterceptor());
  globalInterceptors.push(new PaginationInterceptor());

  await pluginService.bootstrapPublicApp(publicApp);

  publicApp.useGlobalInterceptors(...globalInterceptors);
  const description = readFileSync(
    join(__dirname, '..', 'docs', 'swagger.md'),
    'utf8',
  );

  let documentBuilder = new DocumentBuilder()
    .setTitle('Elrond API')
    .setDescription(description)
    .setVersion('1.0.0')
    .setExternalDoc('Elrond Docs', 'https://docs.elrond.com');

  const apiUrls = apiConfigService.getApiUrls();
  for (const apiUrl of apiUrls) {
    documentBuilder = documentBuilder.addServer(apiUrl);
  }

  const config = documentBuilder.build();

  const document = SwaggerModule.createDocument(publicApp, config);
  SwaggerModule.setup('docs', publicApp, document);
  SwaggerModule.setup('', publicApp, document);

  if (apiConfigService.getIsPublicApiActive()) {
    await publicApp.listen(3001);
  }

  if (apiConfigService.getIsPrivateApiActive()) {
    const privateApp = await NestFactory.create(PrivateAppModule);
    await privateApp.listen(4001);
  }

  if (apiConfigService.getIsTransactionProcessorCronActive()) {
    const processorApp = await NestFactory.create(TransactionProcessorModule);
    await processorApp.listen(5001);
  }

  if (apiConfigService.getIsTransactionCompletedCronActive()) {
    const processorApp = await NestFactory.create(TransactionCompletedModule);
    await processorApp.listen(7001);
  }

  if (apiConfigService.getIsCacheWarmerCronActive()) {
    const processorApp = await NestFactory.create(CacheWarmerModule);
    await processorApp.listen(6001);
  }

  if (apiConfigService.getIsQueueWorkerCronActive()) {
    const queueWorkerApp =
      await NestFactory.createMicroservice<MicroserviceOptions>(
        NftQueueModule,
        {
          transport: Transport.RMQ,
          options: {
            urls: [apiConfigService.getRabbitmqUrl()],
            queue: 'api-process-nfts',
            noAck: false,
            prefetchCount: apiConfigService.getNftProcessParallelism(),
            queueOptions: {
              durable: true,
              // arguments: {
              //   'x-single-active-consumer': true,
              // },
              deadLetterExchange: 'api-process-nfts-dlq',
            },
          },
        },
      );
    await queueWorkerApp.listen();
  }

  const logger = new Logger('Bootstrapper');

  const pubSubApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    PubSubListenerModule,
    {
      transport: Transport.REDIS,
      options: {
        url: `${apiConfigService.getRedisUrl()}`,
        retryAttempts: 100,
        retryDelay: 1000,
        retry_strategy: function (_: any) {
          return 1000;
        },
      },
    },
  );
  pubSubApp.useWebSocketAdapter(new SocketAdapter(pubSubApp));
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  pubSubApp.listen();

  logger.log(`Public API active: ${apiConfigService.getIsPublicApiActive()}`);
  logger.log(`Private API active: ${apiConfigService.getIsPrivateApiActive()}`);
  logger.log(
    `Transaction processor cron active: ${apiConfigService.getIsTransactionProcessorCronActive()}`,
  );
  logger.log(
    `Transaction completed cron active: ${apiConfigService.getIsTransactionCompletedCronActive()}`,
  );
  logger.log(
    `Cache warmer active: ${apiConfigService.getIsCacheWarmerCronActive()}`,
  );
  logger.log(
    `Queue worker active: ${apiConfigService.getIsQueueWorkerCronActive()}`,
  );
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();

RedisClient.prototype.on_error = function (err: any) {
  if (this.closing) {
    return;
  }

  err.message =
    'Redis connection to ' + this.address + ' failed - ' + err.message;
  // debug(err.message);
  this.connected = false;
  this.ready = false;

  // Only emit the error if the retry_strategy option is not set
  if (!this.options.retry_strategy) {
    // this.emit('error', err);
  }
  // 'error' events get turned into exceptions if they aren't listened for. If the user handled this error
  // then we should try to reconnect.
  this.connection_gone('error', err);
};
