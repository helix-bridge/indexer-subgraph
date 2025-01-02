import {
    TokenLocked,
    LnProviderUpdated,
    SlashRequest,
    LiquidityWithdrawn,
    PenaltyReserveUpdated,
    LnProviderPaused,
    TransferFilled,
    LiquidityWithdrawRequested,
} from "../generated/HelixLnBridgeV3.HelixLnBridgeV3";
import {
    Lnv3TransferRecord,
    Lnv3RelayRecord,
    LnNonceOrder,
    Lnv3PenaltyReserve,
    Lnv3RelayUpdateRecord,
} from "../generated/schema";

const PROVIDER_UPDATE = 0;
const PAUSE_UPDATE = 1;

const lockRecordNonceId = "0x01";
const providerUpdateNonce = "0x02";

// target chain
// order is not needed, query by transferId
export async function handleTransferFilled(event: TransferFilled): Promise<void> {
  let messageId = event.params.transferId;
  let entity = await Lnv3RelayRecord.load(messageId);
  if (entity == null) {
      entity = new Lnv3RelayRecord(messageId);
  }
  entity.timestamp = event.blockTimestamp;
  entity.localChainId = event.context.chainId;
  entity.relayer = event.params.provider;
  entity.transactionHash = event.transaction.hash;
  entity.slashed = false;
  entity.fee = (event.transaction.gasUsed * event.transaction.gasPrice).toString();
  await entity.save();
}

export async function handleSlashRequest(event: SlashRequest): Promise<void> {
  let messageId = event.params.transferId;
  let entity = await Lnv3RelayRecord.load(messageId);
  if (entity == null) {
      entity = new Lnv3RelayRecord(messageId);
  }
  entity.timestamp = event.blockTimestamp;
  entity.localChainId = event.context.chainId;
  entity.relayer = event.params.provider;
  entity.transactionHash = event.transaction.hash;
  entity.slashed = true;
  await entity.save();
}

export async function handleLiquidityWithdrawRequested(event: LiquidityWithdrawRequested): Promise<void> {
  for (let i = 0; i < event.params.transferIds.length; i++) {
    const transferId = event.params.transferIds[i];
    let entity = await Lnv3RelayRecord.load(transferId);
    if (entity == null) {
      return;
    }
    entity.requestWithdrawTimestamp = event.blockTimestamp;
    await entity.save();
  }
}
// **************** target chain end ******************

// **************** source chain start ****************
export async function handleTokenLocked(event: TokenLocked): Promise<void> {
  let transferId = event.params.transferId;
  let entity = await Lnv3TransferRecord.load(transferId);
  if (entity == null) {
      entity = new Lnv3TransferRecord(transferId);
  }

  let counterId = `${lockRecordNonceId}-${event.context.chainId}`;
  let counter = await LnNonceOrder.load(counterId);
  if (counter == null) {
      counter = new LnNonceOrder(counterId);
      counter.count = BigInt(0);
  }
  counter.count = counter.count + BigInt(1);
  await counter.save();

  entity.nonce = counter.count;
  entity.messageNonce = event.params.timestamp;
  entity.localChainId = event.context.chainId;
  entity.remoteChainId = event.params.remoteChainId;
  entity.provider = event.params.provider;
  entity.sourceToken = event.params.sourceToken;
  entity.targetToken = event.params.targetToken;
  entity.sourceAmount = event.params.amount.toString();
  entity.targetAmount = event.params.targetAmount.toString();
  entity.sender = event.transaction.from;
  entity.receiver = event.params.receiver;
  entity.timestamp = event.blockTimestamp;
  entity.transactionHash = event.transaction.hash;
  entity.fee = event.params.fee.toString();
  entity.transferId = event.params.transferId;
  await entity.save();
}

export async function handleLiquidityWithdrawn(event: LiquidityWithdrawn): Promise<void> {
  for (let i = 0; i < event.params.transferIds.length; i++) {
    const transferId = event.params.transferIds[i];
    let entity = await Lnv3TransferRecord.load(transferId);
    if (entity == null) {
      return;
    }
    entity.hasWithdrawn = true;
    await entity.save();
  }
}

export async function handleLnProviderUpdated(event: LnProviderUpdated): Promise<void> {
  let id = event.transaction.hash;
  let relayEntity = await Lnv3RelayUpdateRecord.load(id);
  if (relayEntity == null) {
      relayEntity = new Lnv3RelayUpdateRecord(id);
  }

  let counterId = `${providerUpdateNonce}-${event.context.chainId}`;
  let counter = await LnNonceOrder.load(counterId);
  if (counter == null) {
      counter = new LnNonceOrder(counterId);
      counter.count = BigInt(0);
  }
  counter.count = counter.count + BigInt(1);
  await counter.save();

  relayEntity.localChainId = event.context.chainId;
  relayEntity.remoteChainId = event.params.remoteChainId;
  relayEntity.nonce = counter.count;
  relayEntity.updateType = PROVIDER_UPDATE;
  relayEntity.provider = event.params.provider;
  relayEntity.sourceToken = event.params.sourceToken;
  relayEntity.targetToken = event.params.targetToken;
  relayEntity.transactionHash = event.transaction.hash;
  relayEntity.timestamp = event.blockTimestamp;
  relayEntity.baseFee = event.params.baseFee.toString();
  relayEntity.liquidityFeeRate = Number(event.params.liquidityfeeRate);
  relayEntity.transferLimit = event.params.transferLimit.toString();
  await relayEntity.save();
}

export async function handlePenaltyReserveUpdated(event: PenaltyReserveUpdated): Promise<void> {
  const provider = event.params.provider;
  const sourceToken = event.params.sourceToken;
  let id = `${provider}-${sourceToken}`;
  let entity = await Lnv3PenaltyReserve.load(id);
  if (entity == null) {
      entity = new Lnv3PenaltyReserve(id);
  }
  entity.localChainId = event.context.chainId;
  entity.provider = provider;
  entity.sourceToken = sourceToken;
  entity.penaltyReserved = event.params.updatedPanaltyReserve.toString();
  await entity.save();
}

export async function handleLnProviderPaused(event: LnProviderPaused): Promise<void> {
  let id = event.transaction.hash;
  let relayEntity = await Lnv3RelayUpdateRecord.load(id);
  if (relayEntity == null) {
      relayEntity = new Lnv3RelayUpdateRecord(id);
  }

  let counterId = `${providerUpdateNonce}-${event.context.chainId}`;
  let counter = await LnNonceOrder.load(counterId);
  if (counter == null) {
      counter = new LnNonceOrder(counterId);
      counter.count = BigInt(0);
  }
  counter.count = counter.count + BigInt(1);
  await counter.save();

  relayEntity.localChainId = event.context.chainId;
  relayEntity.remoteChainId = event.params.remoteChainId;
  relayEntity.nonce = counter.count;
  relayEntity.updateType = PAUSE_UPDATE;
  relayEntity.provider = event.params.provider;
  relayEntity.sourceToken = event.params.sourceToken;
  relayEntity.targetToken = event.params.targetToken;
  relayEntity.transactionHash = event.transaction.hash;
  relayEntity.timestamp = event.blockTimestamp;
  relayEntity.paused = event.params.paused;
  await relayEntity.save();
}
// **************** source chain end ****************

