import mongoose, { type ClientSession } from 'mongoose';
import { config } from './config';

export async function connectDb() {
  await mongoose.connect(config.mongoUri);
}

/** Runs fn inside a MongoDB transaction (needs a replica set). */
export async function withTx<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let out!: T;
    await session.withTransaction(async () => {
      out = await fn(session);
    });
    return out;
  } finally {
    await session.endSession();
  }
}
