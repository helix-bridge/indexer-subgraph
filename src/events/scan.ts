import axios from 'axios';
import { Logger } from '@nestjs/common';
import { ethers } from "ethers";
import { Transaction, EventContext } from './event.base';
import { PrismaClient } from "@prisma/client";
import { IndexLogger } from "../utils/logger";

export const prismaClientGlobal: PrismaClient = new PrismaClient();

interface Contract {
    address: string;
    abi: string[];
}

interface SubgraphEventHandler {
    subgraph: string;
    handler: (event: EventData, context: EventContext) => Promise<void>;
}

interface EventHandler {
    contractInterface: ethers.Interface;
    handlers: SubgraphEventHandler[];
    hasReceipt: boolean;
    hasTimestamp: boolean;
}

export interface EventArgs {
    argsType: 'ScaleValue' | 'Array';
    value: string | string[];
}

export interface EventData {
    name: string;
    args: EventArgs[];
    tx: Transaction | null;
    blockTimestamp: number | null;
}

export interface EventABI {
    abi: string;
    hasReceipt: boolean;
    hasTimestamp: boolean;
}

export class ScanLogs {
    private readonly logger: IndexLogger;
    public lastScannedBlock: number = 0;
    public cacheLatestBlock: number = 0;
    public scanedEventCount: number = 0;
    private eventHandlers: Map<string, EventHandler> = new Map();
    private provider: ethers.JsonRpcProvider;
    private topics: string[] = [];
    private nextURL: number = 0;
    private isScanning: boolean = false;

    constructor(
        public urls: string[],
        public startBlock: number,
        public scanRange: number,
        public chainId: number,
        public name: string,
        public scanInterval: number,
        public reorg: number,
        public rewrite: boolean,
    ) {
        this.provider = new ethers.JsonRpcProvider(urls[0]);
        this.logger = IndexLogger.getGlobalLogger();
    }

    async getBlockByNumber(blockNumber: number) {
        const data = {
            method: "eth_getBlockByNumber",
            params: ["0x" + blockNumber.toString(16), false],
            id: 1,
            jsonrpc: "2.0"
        };
        const block = await axios.post(this.urls[this.nextURL],
            data,
            { headers: { 'Content-Type': 'application/json'} }
        )
        .then((res) => res.data.result);
        return block;
    }

    addEventHandler(subgraph: string, address: string, abis: EventABI[], handler: (event: EventData, context: EventContext) => Promise<void>) {
        // topics
        let topics = abis.map((abi) => {
            return {
                topic: ethers.id(abi.abi.substr(6)),
                abi: abi,
            }
        });
        this.topics.push(...topics.map(e => e.topic));

        for (const topic of topics) {
            const key = `${address.toLowerCase()}-${topic.topic}`;
            const handlers = this.eventHandlers.get(key);
            if (!handlers) {
                this.eventHandlers.set(key, {
                    contractInterface: new ethers.Interface([topic.abi.abi]),
                    handlers: [{subgraph, handler}],
                    hasReceipt: topic.abi.hasReceipt,
                    hasTimestamp: topic.abi.hasTimestamp,
                });
            } else {
                handlers.handlers.push({subgraph, handler});
            }
        }

        console.log(this.topics);
    }

    async scan() {
        if (this.isScanning) return;
        this.isScanning = true;
        const startTimestamp = Date.now()/1000;
        try {
            if (this.cacheLatestBlock <= this.lastScannedBlock + this.scanRange) {
                this.cacheLatestBlock = await this.provider.getBlockNumber();
            }
            // read startBlock from db
            /* {
             *   chainId,
             *   latestBlock,
             *   finalizedBlock,
             * }
             */
            if (this.lastScannedBlock === 0) {
                if (this.rewrite) {
                    this.lastScannedBlock = this.startBlock;
                } else {
                    const lastBlock = await prismaClientGlobal.lastBlock.findUnique({
                        where: {id: this.chainId.toString()},
                    });
                    if (lastBlock) {
                        this.lastScannedBlock = Number(lastBlock.blockNumber);
                        this.scanedEventCount = Number(lastBlock.scanedEvent);
                    } else {
                        this.lastScannedBlock = this.startBlock;
                    }
                }
            }
            if (this.cacheLatestBlock > this.lastScannedBlock) {
                let endBlock = this.lastScannedBlock + this.scanRange;
                if (endBlock > this.cacheLatestBlock - this.reorg) {
                    endBlock = this.cacheLatestBlock - this.reorg;
                }
                if (endBlock < this.lastScannedBlock + 1) {
                    this.isScanning = false;
                    return;
                }
                const keys = Array.from(this.eventHandlers.keys());
                const addresses: string[] = keys.map(key => key.split("-")[0]);
                const logs = await this.provider.getLogs({
                    fromBlock: this.lastScannedBlock + 1,
                    toBlock: endBlock,
                    address: Array.from(new Set(addresses)),
                    topics: [
                        Array.from(new Set(this.topics)),
                    ],
                });
                let blocks = new Map();
                for (const log of logs) {
                    const key = `${log.address.toLowerCase()}-${log.topics[0]}`;
                    const eventHandler = this.eventHandlers.get(key);
                    if (eventHandler) {
                        const parsedLog = eventHandler.contractInterface.parseLog(log);
                        let args: EventArgs[] = [];
                        for (const arg of parsedLog.args) {
                            if (typeof arg == 'object') {
                                let innerArgs: string[] = [];
                                for (const argField of arg) {
                                    innerArgs.push(argField);
                                }
                                args.push({argsType: 'Array', value: innerArgs});
                            } else {
                                args.push({argsType: 'ScaleValue', value: arg});
                            }
                        }
                        let timestamp = null;
                        if (eventHandler.hasTimestamp) {
                            let block = blocks.get(log.blockNumber);
                            if (!block) {
                                block = await this.getBlockByNumber(log.blockNumber);
                                blocks.set(log.blockNumber, block);
                            }
                            timestamp = Number(BigInt(block.timestamp));
                        }
                        let transaction = null;
                        if (eventHandler.hasReceipt) {
                            const tx = await this.provider.getTransaction(log.transactionHash);
                            const receipt = await this.provider.getTransactionReceipt(log.transactionHash);
                            transaction = {
                                hash: receipt.hash,
                                index: receipt.index,
                                from: receipt.from,
                                to: receipt.to,
                                value: tx.value,
                                gasUsed: receipt.cumulativeGasUsed,
                                gasPrice: receipt.gasPrice,
                                logs: receipt.logs.map((log) => {
                                    return {
                                        address: log.address.toLowerCase(),
                                        data: log.data,
                                        topics: log.topics.map((t) => t),
                                            index: log.index,
                                    };
                                }),
                            };
                        }
                        this.scanedEventCount += 1;
                        const context: EventContext = {
                            chainId: BigInt(this.chainId),
                            address: log.address.toLowerCase(),
                        };
                        for (const handler of eventHandler.handlers) {
                            const now = Date.now()/1000;
                            const cost = timestamp !== null ? `cost ${(now-timestamp).toFixed()}` : "";
                            this.logger.log(
                                `[${this.name}-${this.chainId}-${handler.subgraph}] Trigger ${parsedLog.name} at ${log.blockNumber} in tx ${log.transactionHash} ${cost}`
                            );
                            this.logger.upinsertBar(`scan-${this.chainId}`, this.name, this.lastScannedBlock, this.cacheLatestBlock-this.reorg, 0);
                            this.logger.renderBars();
                            await handler.handler({
                                name: parsedLog.name,
                                args: args,
                                tx: transaction,
                                blockTimestamp: timestamp,
                            }, context);
                        }
                    }
                }
                this.lastScannedBlock = endBlock;
                await prismaClientGlobal.lastBlock.upsert({
                    where: { id: this.chainId.toString() },
                    update: { blockNumber: endBlock, scanedEvent: this.scanedEventCount },
                    create: { id: this.chainId.toString(), blockNumber: endBlock, scanedEvent: this.scanedEventCount },
                });
                const endTimestamp = Date.now()/1000;
                this.logger.upinsertBar(`scan-${this.chainId}`, this.name, this.lastScannedBlock, this.cacheLatestBlock-this.reorg, endTimestamp - startTimestamp);
                this.logger.renderBars();
            }
        } catch(err) {
            const endTimestamp = Date.now()/1000;
            this.logger.warn(`scan logs failed cost ${(endTimestamp-startTimestamp).toFixed(2)}, url: ${this.urls[this.nextURL]} ${err}`);
            this.logger.renderBars();
            this.nextURL++;
            if (this.nextURL >= this.urls.length) {
                this.nextURL = 0;
            }
            this.provider.destroy();
            this.provider = new ethers.JsonRpcProvider(this.urls[this.nextURL]);
        }
        this.isScanning = false;
    }
}
