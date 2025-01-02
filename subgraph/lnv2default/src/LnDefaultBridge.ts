import {
    TokenLocked,
    TransferFilled,
    Slash,
    MarginUpdated,
    LnProviderUpdated,
} from "../generated/LnDefaultBridge.LnDefaultBridge"
import { Lnv2RelayRecord, Lnv2TransferRecord, LnNonceOrder, Lnv2RelayUpdateRecord } from "../generated/schema"

const PROVIDER_UPDATE = 0;
const SLASH = 1;
// withdraw or deposit
const MARGIN_UPDATE = 2;

const lockRecordNonceId = "0x01";
const marginUpdateNonce = "0x02";
const feeUpdated = "0x03";

// target chain
// order is not needed, query by transferId
export async function handleTransferFilled(event: TransferFilled): Promise<void> {
  let message_id = event.params.transferId;
  let entity = await Lnv2RelayRecord.load(message_id);
  if (entity == null) {
      entity = new Lnv2RelayRecord(message_id);
  }
  entity.timestamp = event.blockTimestamp;
  entity.transactionHash = event.transaction.hash;
  entity.localChainId = event.context.chainId;
  entity.fee = (event.transaction.gasUsed * event.transaction.gasPrice).toString();
  await entity.save();
}

export async function handleSlash(event: Slash): Promise<void> {
  let message_id = event.params.transferId;
  let entity = await Lnv2RelayRecord.load(message_id);
  if (entity == null) {
      entity = new Lnv2RelayRecord(message_id);
  }
  entity.slasher = event.params.slasher;
  entity.timestamp = event.blockTimestamp;
  entity.transactionHash = event.transaction.hash;
  entity.localChainId = event.context.chainId;
  entity.save();
  let id = event.transaction.hash;
  let relayEntity = await Lnv2RelayUpdateRecord.load(id);
  if (relayEntity == null) {
      relayEntity = new Lnv2RelayUpdateRecord(id);
  }
  
  // ordger relay update
  let counter = await LnNonceOrder.load(marginUpdateNonce);
  if (counter == null) {
      counter = new LnNonceOrder(marginUpdateNonce);
      counter.count = BigInt(0);
  }
  counter.count = counter.count + BigInt(1);
  await counter.save();

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

export async function handleMarginUpdated(event: MarginUpdated): Promise<void> {
  let id = event.transaction.hash;
  let relayEntity = await Lnv2RelayUpdateRecord.load(id);
  if (relayEntity == null) {
      relayEntity = new Lnv2RelayUpdateRecord(id);
  }
  let counter = await LnNonceOrder.load(marginUpdateNonce);
  if (counter == null) {
      counter = new LnNonceOrder(marginUpdateNonce);
      counter.count = BigInt(0);
  }
  counter.count = counter.count + BigInt(1);
  await counter.save();

  relayEntity.remoteChainId = event.params.remoteChainId;
  relayEntity.localChainId = event.context.chainId;
  relayEntity.nonce = counter.count;
  relayEntity.updateType = MARGIN_UPDATE;
  relayEntity.provider = event.params.provider;
  relayEntity.sourceToken = event.params.sourceToken;
  relayEntity.targetToken = event.params.targetToken;
  relayEntity.transactionHash = event.transaction.hash;
  relayEntity.timestamp = event.blockTimestamp;
  relayEntity.margin = event.params.amount.toString();
  relayEntity.withdrawNonce = event.params.withdrawNonce;
  await relayEntity.save();
}
// **************** target chain end ******************

// **************** source chain start ****************
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
  entity.timestamp = event.blockTimestamp;
  entity.fee = event.params.fee.toString();
  await entity.save();
}

export async function handleLnProviderUpdated(event: LnProviderUpdated): Promise<void> {
  let id = event.transaction.hash;
  let relayEntity = await Lnv2RelayUpdateRecord.load(id);
  if (relayEntity == null) {
      relayEntity = new Lnv2RelayUpdateRecord(id);
  }

  let counter = await LnNonceOrder.load(feeUpdated);
  if (counter == null) {
      counter = new LnNonceOrder(feeUpdated);
      counter.count = BigInt(0);
  }
  counter.count = counter.count + BigInt(1);
  await counter.save();

  relayEntity.remoteChainId = event.params.remoteChainId;
  relayEntity.localChainId = event.context.chainId;
  relayEntity.nonce = counter.count;
  relayEntity.updateType = PROVIDER_UPDATE;
  relayEntity.provider = event.params.provider;
  relayEntity.sourceToken = event.params.sourceToken;
  relayEntity.targetToken = event.params.targetToken;
  relayEntity.transactionHash = event.transaction.hash;
  relayEntity.timestamp = event.blockTimestamp;
  relayEntity.baseFee = event.params.baseFee.toString();
  relayEntity.liquidityFeeRate = event.params.liquidityfeeRate;
  await relayEntity.save();
}
// **************** source chain end ****************

