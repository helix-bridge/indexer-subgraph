import {
  TokenDeposit,
  TokenClaimed,
} from "../generated/XToken.Guard"

import {
  MessageDispatchedResult,
  TransferId2MessageId,
} from "../generated/schema"

import { TransactionLog } from "../../../events/event.base";

const STATUS_PENDING_TOCLAIM = 3;
// claimed
const STATUS_CLAIMED = 4;

function isMsglineContract(event: TransactionLog): boolean {
    return event.address.toLowerCase() == '0x13b2211a7ca45db2808f6db05557ce5347e3634e' ||
        event.address.toLowerCase() == '0x924a4b87900a8ce8f8cf62360db047c4e4ffc1a3' ||
        event.address.toLowerCase() == '0x00000000001523057a05d6293c1e5171ee33ee0a' ||
        event.address.toLowerCase() == '0x5c5c383febe62f377f8c0ea1de97f2a2ba102e98' ||
        event.address.toLowerCase() == '0x0000000005d961f950ada391c1511c92bbc64d9f' ||
        event.address.toLowerCase() == '0xe46ed7594ffa6ad7c3b5232827ec2af8f94beb38'||
        event.address.toLowerCase() == '0x9bec71b9c646653c6c73af8d4b7e5f84a5420005';
}

function isMsglineDispatchEvent(event: TransactionLog): boolean {
    return event.topics[0] == '0x62b1dc20fd6f1518626da5b6f9897e8cd4ebadbad071bb66dc96a37c970087a8' &&
        isMsglineContract(event);
}

export async function handleTokenDeposit(event: TokenDeposit): Promise<void> {
  var messageId = '';
  // find the messageId
  const logs = event.transaction.logs;
  for (var idx = 0; idx < logs.length; idx++) {
      if (isMsglineDispatchEvent(logs[idx])) {
          messageId = logs[idx].topics[1];
          break;
      }
  }

  if (messageId === '') {
      return;
  }

  let entity = await MessageDispatchedResult.load(messageId);
  if (entity == null) {
      entity = new MessageDispatchedResult(messageId);
  }
  entity.localChainId = event.context.chainId;
  entity.timestamp = BigInt(event.blockTimestamp);
  entity.transactionHash = event.transaction.hash;
  entity.token = event.params.token;
  entity.result = STATUS_PENDING_TOCLAIM;
  await entity.save();

  const transferId = "0x" + event.params.id.toString(16);
  let idEntity = await TransferId2MessageId.load(transferId);
  if (idEntity == null) {
      idEntity = new TransferId2MessageId(transferId);
  }
  idEntity.localChainId = event.context.chainId;
  idEntity.messageId = messageId;
  await idEntity.save();
}

export async function handleTokenClaimed(event: TokenClaimed): Promise<void> {
  let transferId = "0x" + event.params.id.toString(16);
  let idEntity = await TransferId2MessageId.load(transferId);
  if (idEntity == null) {
      return;
  }
  let entity = await MessageDispatchedResult.load(idEntity.messageId);
  if (entity == null) {
      return;
  }
  entity.localChainId = event.context.chainId;
  entity.transactionHash = event.transaction.hash;
  entity.result = STATUS_CLAIMED;
  await entity.save();
}

