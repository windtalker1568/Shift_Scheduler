import mongoose, { type ClientSession } from 'mongoose';
import { config } from './config';
import { Person } from './models';

export async function connectDb() {
  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection did not provide a database');
  await Person.init();
  const people = db.collection('people');
  const indexes = await people.indexes();
  const legacyIndex = indexes.find((index) => index.key.employeeId === 1);
  if (legacyIndex?.name) await people.dropIndex(legacyIndex.name);
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
