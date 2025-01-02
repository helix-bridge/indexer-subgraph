import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { last } from 'lodash';
import { TasksService } from '../tasks/tasks.service';
import { ChainManager } from '../.generate/src/event.chain';

@Injectable()
export class EventService implements OnModuleInit {
    private readonly logger = new Logger("event");
    private chainManager = new ChainManager();

    constructor(
        private taskService: TasksService,
    ) {}

    async onModuleInit() {
        this.logger.log("event service start");
        this.chainManager.scaners.forEach((scaner, index) => {
            this.taskService.addInterval(
                `${scaner.chainId}`,
                scaner.scanInterval,
                async () => {
                    await scaner.scan();
                }
            );
        });
    }

    chainData(id: number) {
        return this.chainManager.scanData(id);
    }
}
