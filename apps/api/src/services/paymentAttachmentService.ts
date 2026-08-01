import { createHash } from 'node:crypto';
import { ClientSession, Types } from 'mongoose';
import { PaymentAttachment } from '../models/PaymentAttachment';

export type PaymentAttachmentInput = {
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'application/pdf';
  base64Data: string;
};

const signatures: Record<PaymentAttachmentInput['mimeType'], number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
};

function decodeAndValidate(input: PaymentAttachmentInput) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64Data)) {
    throw Object.assign(new Error('Payment attachment is not valid base64'), {
      statusCode: 400,
      code: 'INVALID_ATTACHMENT',
    });
  }
  const data = Buffer.from(input.base64Data, 'base64');
  if (data.length === 0 || data.length > 2_000_000) {
    throw Object.assign(new Error('Payment attachment must be at most 2 MB'), {
      statusCode: 400,
      code: 'ATTACHMENT_SIZE',
    });
  }
  const expected = signatures[input.mimeType];
  if (!expected.every((byte, index) => data[index] === byte)) {
    throw Object.assign(new Error('Payment attachment content does not match its media type'), {
      statusCode: 400,
      code: 'ATTACHMENT_TYPE',
    });
  }
  return data;
}

export interface PaymentAttachmentStorage {
  save(
    paymentId: Types.ObjectId,
    input: PaymentAttachmentInput,
    uploadedBy: Types.ObjectId,
    session: ClientSession,
  ): Promise<InstanceType<typeof PaymentAttachment>>;
}

class MongoPaymentAttachmentStorage implements PaymentAttachmentStorage {
  async save(
    paymentId: Types.ObjectId,
    input: PaymentAttachmentInput,
    uploadedBy: Types.ObjectId,
    session: ClientSession,
  ) {
    const data = decodeAndValidate(input);
    const [attachment] = await PaymentAttachment.create(
      [
        {
          paymentId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: data.length,
          sha256: createHash('sha256').update(data).digest('hex'),
          data,
          uploadedBy,
        },
      ],
      { session },
    );
    return attachment;
  }
}

export const paymentAttachmentStorage: PaymentAttachmentStorage =
  new MongoPaymentAttachmentStorage();
