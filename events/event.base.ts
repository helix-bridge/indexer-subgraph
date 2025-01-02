export interface TransactionLog {
    address: string;
    data: string;
    topics: string[];
    index: number;
}

export interface Transaction {
    hash: string;
    index: number;
    from: string;
    to: string;
    value: bigint;
    gasUsed: bigint;
    gasPrice: bigint;
    logs: TransactionLog[];
}

export interface EventParam {
    type: string;
    value: string | boolean | number | bigint | string[];
}

export interface EventContext {
    chainId: bigint;
    address: string;
}

export class Event {
    constructor(
        public context: EventContext,
        public transaction: Transaction,
        public blockTimestamp: number,
        public parameters: EventParam[],
    ) {}
}
