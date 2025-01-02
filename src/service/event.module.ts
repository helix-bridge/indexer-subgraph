import { Module } from "@nestjs/common";
import { TasksModule } from "../tasks/tasks.module";
import { EventService } from "./event.service";

@Module({
  imports: [TasksModule],
  providers: [EventService],
  exports: [EventService],
})
export class EventModule {}
