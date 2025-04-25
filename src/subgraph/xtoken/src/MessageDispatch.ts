import {
  CallResult,
} from "../generated/XToken.MsglineMessager"

import {
  MessageDispatched,
} from "../generated/XToken.ormp"

import {
    MessageDispatchedResult,
    TransferId2MessageId,
} from "../generated/schema";

import { TransactionLog } from "../../../events/event.base";

// default status
const STATUS_DELIVERED = 0;
// app call failed
const STATUS_FAILED = 1;
// app call successed, maybe pending to claim
// 1. no need to claim: finished
// 2. need to claim: pending to claim
const STATUS_DELIVERED_SUCCESSED = 2;

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


function isGuardDepositEvent(event: TransactionLog): boolean {
    return event.topics[0] == '0xe15a305c9965c563f86d698c22d072ae55c831930e4bcfc3cacf9050bbdc69d2';
}

export async function handleMessageDispatched(event: MessageDispatched): Promise<void> {
  let message_id = event.params.msgHash;
  let entity = await MessageDispatchedResult.load(message_id);
  if (entity == null) {
      entity = new MessageDispatchedResult(message_id);
  }
  entity.localChainId = event.context.chainId;
  entity.timestamp = BigInt(event.blockTimestamp);
  entity.transactionHash = event.transaction.hash;
  if (!event.params.dispatchResult) {
      entity.result = STATUS_FAILED;
  }
  await entity.save();
}

export async function handleCallResult(event: CallResult): Promise<void> {
  var messageId = '';
  var usingGuard = false;
  // find the messageId
  const logs = event.transaction.logs;
  for (var idx = event.context.index; idx < logs.length; idx++) {
      if (isMsglineDispatchEvent(logs[idx]) && messageId !== '') {
          messageId = logs[idx].topics[1];
      } else if (isGuardDepositEvent(logs[idx])) {
          usingGuard = true;
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
  if (!event.params.result) {
      entity.result = STATUS_FAILED;
  } else if((!entity.result || entity.result < STATUS_DELIVERED_SUCCESSED) && !usingGuard) {
      entity.result = STATUS_DELIVERED_SUCCESSED;
  }
  await entity.save();
}

