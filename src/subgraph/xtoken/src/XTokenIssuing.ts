import {
    BurnAndXUnlocked,
    RollbackLockAndXIssueRequested,
} from "../generated/XToken.XTokenIssuing";
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
    if (isWTokenConvertor(address)) {
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
            event.topics[0] == '0x40195d26d027672e04e23e34282d68c3d43ea138415b24c54fcdb9c2573e5975' ||
            event.topics[0] == '0xcfb9b3466878aff0c7df17da215fd57d59eb245a5d03f5a7b57294d54581eb18') &&
        isMsglineContract(event);
}

function isWTokenConvertor(address: string): boolean {
    return address.toLowerCase() == "0xc9ea55e644f496d6caaedcbad91de7481dcd7517" ||
        address.toLowerCase() == "0x547cdb578a89517c75a0fa18a56232a357910c52" ||
        address.toLowerCase() == "0xa8d0e9a45249ec839c397fa0f371f5f64ecab7f7" ||
        address.toLowerCase() == "0x004d0de211bc148c3ce696c51cbc85bd421727e9" ||
        address.toLowerCase() == "0x092e19c46c9daab7824393f1cd9c22f5bea13560" ||
        address.toLowerCase() == "0x510a820e41bb6d828a29332db551b6b3cf7232d3";
}

function isGuardAddress(address: string): boolean {
    return address == "0x4ca75992d2750bec270731a72dfdede6b9e71cc7";
}

export async function handleBurnAndXUnlocked(event: BurnAndXUnlocked): Promise<void> {
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

  entity.direction = 'burn';
  entity.localChainId = event.context.chainId;
  entity.remoteChainId = event.params.remoteChainId;
  entity.nonce = counter.count;
  entity.sender = event.transaction.from;
  const recipient = event.params.recipient;
  entity.receiver = recipient;
  entity.token = event.params.originalToken;
  entity.amount = event.params.amount.toString();
  entity.transactionHash = event.transaction.hash;
  entity.timestamp = BigInt(event.blockTimestamp);
  entity.fee = event.params.fee.toString();
  entity.userNonce = event.params.nonce.toString();
  const extData = event.params.extData;
  entity.extData = extData;

  if (isGuardAddress(recipient)) {
      entity.receiver = parseExtData(extData);
  } else if (isWTokenConvertor(recipient)) {
      entity.receiver = extData;
  }

  var messageId: string;
  // find the messageId
  const logs = event.transaction.logs;
  for (var idx = event.context.index; idx >= 0; idx--) {
      if (isMsglineAcceptEvent(logs[idx])) {
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
export async function handleRollbackLockAndXIssueRequested(event: RollbackLockAndXIssueRequested): Promise<void> {
  var messageId = '';
  const logs = event.transaction.logs;
  for (var idx = event.context.index; idx >= 0; idx--) {
      if (isMsglineAcceptEvent(logs[idx])) {
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

