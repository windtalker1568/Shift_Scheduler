import mongoose, { type ClientSession } from 'mongoose';
import { config } from './config';
import { Entry, Person } from './models';

export async function connectDb() {
  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection did not provide a database');
  await Person.init();
  const people = db.collection('people');
  const indexes = await people.indexes();
  const legacyIndexes = indexes.filter((index) => index.key.employeeId === 1 || index.key.segment === 1);
  for (const index of legacyIndexes) {
    if (index.name) await people.dropIndex(index.name);
  }
  await people.updateMany({ segment: { $exists: true } }, { $unset: { segment: '' } });
  await Entry.updateMany({ reason: 'CROSS_SEGMENT_NEED' }, { $set: { reason: 'COVERAGE_NEED' } });
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
