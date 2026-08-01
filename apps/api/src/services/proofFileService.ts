import { createHash } from 'node:crypto';
import type { ClientSession, Types } from 'mongoose';
import { ProofFile } from '../models/ProofFile';

export interface ProofFileInput {
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png';
  base64Data: string;
}

export interface ProofFileStorage {
  save(
    deliveryId: Types.ObjectId,
    purpose: 'SIGNATURE' | 'PHOTOGRAPH',
    input: ProofFileInput,
    uploadedBy: Types.ObjectId,
    session: ClientSession,
  ): Promise<Types.ObjectId>;
}

function validatedImage(input: ProofFileInput) {
  const buffer = Buffer.from(input.base64Data, 'base64');
  if (!buffer.length || buffer.length > 2_000_000) {
    throw Object.assign(new Error('Proof image must be between 1 byte and 2 MB'), {
      statusCode: 400,
      code: 'INVALID_PROOF_FILE',
    });
  }
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if ((input.mimeType === 'image/jpeg' && !isJpeg) || (input.mimeType === 'image/png' && !isPng)) {
    throw Object.assign(new Error('Proof file content does not match its image type'), {
      statusCode: 400,
      code: 'INVALID_PROOF_FILE',
    });
  }
  return buffer;
}

export class DatabaseProofFileStorage implements ProofFileStorage {
  async save(
    deliveryId: Types.ObjectId,
    purpose: 'SIGNATURE' | 'PHOTOGRAPH',
    input: ProofFileInput,
    uploadedBy: Types.ObjectId,
    session: ClientSession,
  ) {
    const data = validatedImage(input);
    const [file] = await ProofFile.create(
      [
        {
          deliveryId,
          purpose,
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
    return file._id;
  }
}

export const proofFileStorage: ProofFileStorage = new DatabaseProofFileStorage();
