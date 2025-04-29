import {
    TokenLocked,
    RemoteIssuingFailure,
} from "../generated/XToken.XTokenBacking";
import {
    XTokenNonceOrder,
    TransferRecord,
    RefundTransferRecord,
} from "../generated/schema";
import { TransactionLog } from "../../../events/event.base";

const transferNonceId = "0x01";

// abi.encode(address, bytes)
function parseExtData(extData: string): string {
    const address = '0x' + extData.substring(26, 66);
    if (isXRingConvertor(address)) {
        return '0x' + extData.substring(194, 234);
    } else {
        return address;
    }
}

function isMsglineContract(event: TransactionLog): boolean {
    return event.address.toLowerCase() == '0x13b2211a7ca45db2808f6db05557ce5347e3634e' ||
        event.address.toLowerCase() == '0x5c5c383febe62f377f8c0ea1de97f2a2ba102e98' ||
        event.address.toLowerCase() == '0x924a4b87900a8ce8f8cf62360db047c4e4ffc1a3' ||
        event.address.toLowerCase() == '0x00000000001523057a05d6293c1e5171ee33ee0a';
}

function isMsglineAcceptEvent(event: TransactionLog): boolean {
    return (event.topics[0] == '0x327110434bca326d1f70236295f59c8b472ebc683a6549ca9254697564fec4a5' ||
            event.topics[0] == '0xcfb9b3466878aff0c7df17da215fd57d59eb245a5d03f5a7b57294d54581eb18' ||
            event.topics[0] == '0x40195d26d027672e04e23e34282d68c3d43ea138415b24c54fcdb9c2573e5975')&&
        isMsglineContract(event);
}

function isXRingConvertor(address: string): boolean {
    return address.toLowerCase() == "0xd06cde9b2a330c5ecedbc48920b502dfc590e5cc" ||
        address.toLowerCase() == "0x53352b535fc38843bf1c04dc863bceca855a4811" ||
        address.toLowerCase() == "0x4cdfe9915d2c72506f4fc2363a8eae032e82d1aa" ||
        address.toLowerCase() == '0xc29dcb1f12a1618262ef9fba673b77140adc02d6' ||
        address.toLowerCase() == '0x3217f36ae34aca2ce60d218af8f47d29101204a8';
}

function isGuardAddress(address: string): boolean {
    return address == "0x4ca75992d2750bec270731a72dfdede6b9e71cc7";
}

export async function handleTokenLocked(event: TokenLocked): Promise<void> {
  let message_id = event.params.transferId;
  let entity = await TransferRecord.load(message_id);
  if (entity == null) {
      entity = new TransferRecord(message_id);
  } else {
      return;
  }

  let counterId = `${transferNonceId}-${event.context.chainId}`;
  let counter = await XTokenNonceOrder.load(counterId);
  if (counter == null) {
      counter = new XTokenNonceOrder(counterId);
      counter.count = BigInt(0);
  }
  counter.count = counter.count + BigInt(1);
  await counter.save();

  entity.direction = 'lock';
  entity.localChainId = event.context.chainId;
  entity.remoteChainId = event.params.remoteChainId;
  entity.nonce = counter.count;
  entity.sender = event.transaction.from;
  entity.receiver = event.params.recipient;
  entity.token = event.params.token;
  entity.amount = event.params.amount.toString();
  entity.transactionHash = event.transaction.hash;
  entity.timestamp = BigInt(event.blockTimestamp);
  entity.fee = event.params.fee.toString();
  entity.userNonce = event.params.nonce.toString();
  const extData = event.params.extData;
  entity.extData = extData;

  if (isGuardAddress(entity.receiver)) {
      entity.receiver = parseExtData(extData);
  } else if (isXRingConvertor(entity.receiver)) {
      entity.receiver = extData;
  }

  var messageId: string;
  // find the messageId
  const logs = event.transaction.logs;
  // the first Msgline Event before this Event
  let thisEventFound = false;
  for (var idx = logs.length - 1; idx >=0; idx--) {
      if (logs[idx].index === event.context.index) {
          thisEventFound = true;
          continue;
      }
      if (thisEventFound && isMsglineAcceptEvent(logs[idx])) {
          messageId = logs[idx].topics[1];
          break;
      }
  }
  if (!messageId) {
      return;
  }
  entity.messageId = messageId;
  await entity.save();
}

// refund txs
export async function handleRemoteIssuingFailure(event: RemoteIssuingFailure): Promise<void> {
  var messageId = '';
  const logs = event.transaction.logs;
  let thisEventFound = false;
  for (var idx = logs.length - 1; idx >=0; idx--) {
      if (logs[idx].index === event.context.index) {
          thisEventFound = true;
          continue;
      }
      if (thisEventFound && isMsglineAcceptEvent(logs[idx])) {
          messageId = logs[idx].topics[1];
          break;
      }
  }
  if (!messageId) {
      return;
  }

  let entity = await RefundTransferRecord.load(messageId);
  if (entity == null) {
      entity = new RefundTransferRecord(messageId);
  }
  entity.localChainId = event.context.chainId;
  entity.sourceId = event.params.transferId;
  entity.timestamp = BigInt(event.blockTimestamp);
  entity.transactionHash = event.transaction.hash;
  await entity.save();
}

