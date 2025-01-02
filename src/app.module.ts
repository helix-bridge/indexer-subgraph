import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule, Scalar } from '@nestjs/graphql';
import { ScheduleModule } from '@nestjs/schedule';
import BigInt from 'apollo-type-bigint';
import { join } from 'path';
import { SubgraphModule } from './.generate/subgraph.module';
import { EventModule } from './service/event.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TasksModule } from './tasks/tasks.module';

const chainEnvFilePath = `.env.${process.env.NODE_ENV || 'prod'}`;

@Scalar('BigInt')
export class BigIntScalar extends BigInt {}

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['.env', chainEnvFilePath],
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    TasksModule,
    SubgraphModule,
    EventModule,
  ],
  controllers: [AppController],
  providers: [AppService, BigIntScalar],
})
export class AppModule {}
