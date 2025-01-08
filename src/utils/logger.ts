import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';

@Injectable()
export class IndexLogger extends ConsoleLogger {
    private bars: { id: string, label: string, total: number, current: number, updateTime: number, costTime: number }[] = [];
    private customContext = 'App';
    private readonly itemsEachRow = 3;
    private static globalLogger: IndexLogger;

    constructor(context?: string) {
        super(context || 'logger');
        if (context) {
          this.customContext = context;
        }
    }

    static getGlobalLogger(): IndexLogger {
        if (!this.globalLogger) {
            console.log = (...args: any[]) => {
                return;
            }
            this.globalLogger = new IndexLogger();
        }
        return this.globalLogger;
    }

    @IndexLogger.LogWithBars()
    log(message: string, context?: string) {
        super.log(message, context || this.customContext);
    }

    @IndexLogger.LogWithBars()
    warn(message: string, context?: string) {
        super.warn(message, context || this.customContext);
    }

    @IndexLogger.LogWithBars()
    error(message: string, context?: string) {
        super.error(message, context || this.customContext);
    }

    @IndexLogger.LogWithBars()
    debug(message: string, context?: string) {
        super.debug(message, context || this.customContext);
    }

    @IndexLogger.LogWithBars()
    verbose(message: string, context?: string) {
        super.verbose(message, context || this.customContext);
    }

    private static LogWithBars() {
      return function(target: Object, propertyName: string | symbol, descriptor: TypedPropertyDescriptor<any>) {
        const originalLogMethod = descriptor.value;
        descriptor.value = function(...args: any[]) {
          if (this.bars.length === 0) {
              originalLogMethod.apply(this, args);
              return;
          }
          const totalRows = process.stdout.rows;
          const reservedRows = Math.floor(this.bars.length/this.itemsEachRow) + 1;
          this.bars.forEach((bar, index) => {
              const row = totalRows - reservedRows + Math.floor(index/this.itemsEachRow);
              if (index % this.itemsEachRow === 0) {
                  process.stdout.write(`\x1B[${row + 1};0H`);
                  process.stdout.write('\x1B[2K');
              }
          });
          const row = totalRows - reservedRows;
          process.stdout.write(`\x1B[${row + 1};0H`);
          originalLogMethod.apply(this, args);
          process.stdout.write(`\x1B[${totalRows + 1};0H`);
          process.stdout.write('\n');
        };
        return descriptor;
      };
    }

    upinsertBar(id: string, label: string, current: number, total: number, costTime: number) {
        const bar = this.bars.find(b => b.id === id);
        if (bar) {
            if (bar.total < total || bar.current < current) {
                bar.updateTime = Date.now()/1000;
            }
            bar.current = Math.min(current, total);
            bar.total = total;
            if (costTime > 0) {
                bar.costTime = costTime;
            }
        } else {
            this.bars.push({id, label, total, current, updateTime: Date.now()/1000, costTime: costTime});
        }
    }

    renderBars() {
        const totalRows = process.stdout.rows;
        const reservedRows = Math.floor(this.bars.length/this.itemsEachRow) + 1;
        if (reservedRows > totalRows) {
            this.log('Too many progress bars for terminal height.');
            return;
        }
        const offlineThreshold = 60;
        const now = Date.now()/1000;
        this.bars.forEach((bar, index) => {
            let icon = now > bar.updateTime + offlineThreshold ? '🆘' : bar.total === bar.current ? '✅' : '🔀';
            const progress = Math.floor((bar.current/bar.total)*10);
            const progressColor = progress <= 5 ? 31 : progress <= 8 ? 33 : 32;
            const progressBar = `${'█'.repeat(progress)}${'░'.repeat(10-progress)}`;
            const line = `${icon} ${bar.label}: [\x1B[${progressColor}m${progressBar}](${bar.current}/\x1B[32m${bar.total}\x1B[0m)`;
            const row = totalRows - reservedRows + Math.floor(index/this.itemsEachRow);
            if (index % this.itemsEachRow === 0) {
                process.stdout.write(`\x1B[${row + 1};0H`);
                process.stdout.write('\x1B[2K');
            }
            const costColor = bar.costTime <= 2 ? 32 : bar.costTime < 10 ? 33 : 31;
            process.stdout.write(`${line} [\x1B[${costColor}m${bar.costTime.toFixed(2)}\x1B[0m] `);
        });
    }
}

