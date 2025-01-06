import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IndexLogger } from './utils/logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  const logger = IndexLogger.getGlobalLogger();
  app.useLogger(logger);

  app.setGlobalPrefix('api');

  await app.listen(4002);
}
bootstrap();
