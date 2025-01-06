import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';

@Injectable()
export class IndexLogger extends ConsoleLogger {
    private bars: { id: string, label: string, total: number, current: number }[] = [];
    private customContext = 'App';
    private readonly itemsEachRow = 4;
    private static globalLogger: IndexLogger;

    constructor(context?: string) {
        super(context || 'logger');
        if (context) {
          this.customContext = context;
        }
    }

    static getGlobalLogger(): IndexLogger {
        if (!this.globalLogger) {
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
              const row = totalRows - reservedRows + index/this.itemsEachRow;
              process.stdout.write(`\x1B[${row + 1};0H`);
              process.stdout.write('\x1B[2K');
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

    upinsertBar(id: string, label: string, current: number, total: number) {
        const bar = this.bars.find(b => b.id === id);
        if (bar) {
            bar.current = Math.min(current, total);
            bar.total = total;
        } else {
            this.bars.push({id, label, total, current});
        }
    }

    renderBars() {
        const totalRows = process.stdout.rows;
        const reservedRows = Math.floor(this.bars.length/this.itemsEachRow) + 1;
        if (reservedRows > totalRows) {
            this.log('Too many progress bars for terminal height.');
            return;
        }
        this.bars.forEach((bar, index) => {
            const progress = Math.floor((bar.current/bar.total)*10);
            const progressBar = `${'█'.repeat(progress)}${'░'.repeat(10-progress)}`;
            const line = `${bar.label}:[${progressBar}](${bar.current}/${bar.total})`;
            const row = totalRows - reservedRows + index/this.itemsEachRow;
            if (index % this.itemsEachRow === 0) {
                process.stdout.write(`\x1B[${row + 1};0H`);
                process.stdout.write('\x1B[2K');
            }
            process.stdout.write(`\x1B[1;${31+index%this.itemsEachRow}m${line}\x1B[0m  `);
        });
    }
}

