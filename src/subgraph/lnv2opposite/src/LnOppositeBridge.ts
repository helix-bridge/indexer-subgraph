import {
    TokenLocked,
    TransferFilled,
    Slash,
    LnProviderUpdated,
    LiquidityWithdrawn,
} from "../generated/LnOppositeBridge.LnOppositeBridge"
import { Lnv2TransferRecord, Lnv2RelayRecord, LnNonceOrder, Lnv2RelayUpdateRecord } from "../generated/schema"

const PROVIDER_UPDATE = 0;
const SLASH = 1;
const WITHDRAW = 2;

const lockRecordNonceId = "0x01";
const marginUpdateNonce = "0x02";

// source chain start
export async function handleTokenLocked(event: TokenLocked): Promise<void> {
  let message_id = event.params.transferId;
  let entity = await Lnv2TransferRecord.load(message_id);
  if (entity == null) {
      entity = new Lnv2TransferRecord(message_id);
  }

  let counter = await LnNonceOrder.load(lockRecordNonceId);
  if (counter == null) {
      counter = new LnNonceOrder(lockRecordNonceId);
      counter.count = BigInt(0);
  }
  counter.count = counter.count + BigInt(1);
  await counter.save();

  entity.remoteChainId = event.params.remoteChainId;
  entity.localChainId = event.context.chainId;
  entity.nonce = counter.count;
  entity.sender = event.transaction.from;
  entity.receiver = event.params.receiver;
  entity.provider = event.params.provider;
  entity.sourceToken = event.params.sourceToken;
  entity.targetToken = event.params.targetToken;
  entity.amount = event.params.amount.toString();
  entity.transactionHash = event.transaction.hash;
  entity.timestamp = Number(event.params.timestamp);
  entity.fee = event.params.fee.toString();
  await entity.save();
}

export async function handleLnProviderUpdated(event: LnProviderUpdated): Promise<void> {
  let counter = await LnNonceOrder.load(marginUpdateNonce);
  if (counter == null) {
      counter = new LnNonceOrder(marginUpdateNonce);
      counter.count = BigInt(0);
  }
  counter.count = counter.count + BigInt(1);
  await counter.save();

  let id = event.transaction.hash;
  let relayEntity = await Lnv2RelayUpdateRecord.load(id);
  if (relayEntity == null) {
      relayEntity = new Lnv2RelayUpdateRecord(id);
  }
  relayEntity.remoteChainId = event.params.remoteChainId;
  relayEntity.localChainId = event.context.chainId;
  relayEntity.nonce = counter.count;
  relayEntity.updateType = PROVIDER_UPDATE;
  relayEntity.provider = event.params.provider;
  relayEntity.sourceToken = event.params.sourceToken;
  relayEntity.targetToken = event.params.targetToken;
  relayEntity.transactionHash = event.transaction.hash;
  relayEntity.timestamp = event.blockTimestamp;
  relayEntity.margin = event.params.margin.toString();
  relayEntity.baseFee = event.params.baseFee.toString();
  relayEntity.liquidityFeeRate = event.params.liquidityfeeRate;
  await relayEntity.save();
}

export async function handleLiquidityWithdrawn(event: LiquidityWithdrawn): Promise<void> {
    let counter = await LnNonceOrder.load(marginUpdateNonce);
  if (counter == null) {
      counter = new LnNonceOrder(marginUpdateNonce);
      counter.count = BigInt(0);
  }
  counter.count = counter.count + BigInt(1);
  await counter.save();

  let id = event.transaction.hash;
  let relayEntity = await Lnv2RelayUpdateRecord.load(id);
  if (relayEntity == null) {
      relayEntity = new Lnv2RelayUpdateRecord(id);
  }
  relayEntity.remoteChainId = event.params.remoteChainId;
  relayEntity.localChainId = event.context.chainId;
  relayEntity.nonce = counter.count;
  relayEntity.updateType = WITHDRAW;
  relayEntity.provider = event.params.provider;
  relayEntity.sourceToken = event.params.sourceToken;
  relayEntity.targetToken = event.params.targetToken;
  relayEntity.transactionHash = event.transaction.hash;
  relayEntity.timestamp = event.blockTimestamp;
  relayEntity.margin = event.params.amount.toString();
  await relayEntity.save();
}

export async function handleSlash(event: Slash): Promise<void> {
  let counter = await LnNonceOrder.load(marginUpdateNonce);
  if (counter == null) {
      counter = new LnNonceOrder(marginUpdateNonce);
      counter.count = BigInt(0);
  }
  counter.count = counter.count + BigInt(1);
  await counter.save();

  let id = event.transaction.hash;
  let relayEntity = await Lnv2RelayUpdateRecord.load(id);
  if (relayEntity == null) {
      relayEntity = new Lnv2RelayUpdateRecord(id);
  }
  relayEntity.remoteChainId = event.params.remoteChainId;
  relayEntity.localChainId = event.context.chainId;
  relayEntity.nonce = counter.count;
  relayEntity.updateType = SLASH;
  relayEntity.provider = event.params.provider;
  relayEntity.sourceToken = event.params.sourceToken;
  relayEntity.targetToken = event.params.targetToken;
  relayEntity.transactionHash = event.transaction.hash;
  relayEntity.timestamp = event.blockTimestamp;
  relayEntity.margin = event.params.margin.toString();
  await relayEntity.save();
}
// source chain end

// target chain start
export async function handleTransferFilled(event: TransferFilled): Promise<void> {
  let message_id = event.params.transferId;
  let entity = await Lnv2RelayRecord.load(message_id);
  if (entity == null) {
      entity = new Lnv2RelayRecord(message_id);
  }
  entity.timestamp = event.blockTimestamp;
  entity.localChainId = event.context.chainId;
  entity.transactionHash = event.transaction.hash;
  entity.fee = (event.transaction.gasUsed * event.transaction.gasPrice).toString();
  await entity.save();
}
// target chain end

