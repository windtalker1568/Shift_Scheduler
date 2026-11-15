// Demo data: about 50 people, a few requirements, setup already completed.  Run with: npm run seed
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { ADVISOR_SHIFTS, reqKey, type Classification } from '../../shared/domain';
import { connectDb } from './db';
import { Entry, Person, Requirement, Settings, Team, User, getSettings } from './models';

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Ananya', 'Vikram', 'Isha', 'Arjun', 'Neha', 'Sahil', 'Pooja', 'Rahul', 'Tanvi', 'Karan', 'Riya', 'Aditya', 'Sneha', 'Nikhil', 'Priya'];
const LAST = ['Ghosh', 'Sen', 'Das', 'Roy', 'Mitra', 'Bose', 'Dutta', 'Paul', 'Saha', 'Basu'];
let n = 0;
const nextName = () => `${FIRST[n % FIRST.length]} ${LAST[Math.floor(n / FIRST.length) % LAST.length]}`;

async function main() {
  await connectDb();
  await Promise.all([Entry.deleteMany({}), Requirement.deleteMany({}), Person.deleteMany({}), Team.deleteMany({}), Settings.deleteMany({})]);
  await getSettings();
  if (!(await User.countDocuments())) {
    await User.create({ email: 'manager@example.com', passwordHash: await bcrypt.hash('changeme123', 10) });
    console.log('Demo login: manager@example.com / changeme123  (change it!)');
  }
  const teams: { number: number; cls: Classification; advisors: number }[] = [
    { number: 1, cls: 'NORMAL', advisors: 12 },
    { number: 2, cls: 'NORMAL', advisors: 12 },
    { number: 3, cls: 'KAREN_MILLEN', advisors: 7 },
    { number: 4, cls: 'MIRAKL', advisors: 9 },
  ];
  const people: any[] = [];
  const teamDocs: any[] = [];
  for (const t of teams) {
    const tid = new mongoose.Types.ObjectId();
    const lid = new mongoose.Types.ObjectId();
    teamDocs.push({ _id: tid, teamNumber: t.number, classification: t.cls, leaderPersonId: lid });
    const leaderNumber = ++n;
    people.push({ _id: lid, emailAddress: `person${leaderNumber}@example.com`, name: nextName(), designation: 'TEAM_LEADER', teamId: tid });
    for (let i = 0; i < t.advisors; i++) {
      const personNumber = ++n;
      people.push({ emailAddress: `person${personNumber}@example.com`, name: nextName(), designation: 'ADVISOR', teamId: tid });
    }
  }
  for (const d of ['QA', 'QA', 'TRAINER', 'MANAGEMENT'])
    people.push({ emailAddress: `person${++n}@example.com`, name: nextName(), designation: d });
  await Team.insertMany(teamDocs);
  await Person.insertMany(people);
  await Settings.updateOne({ key: 'main' }, { $set: { setupComplete: true, activeCount: people.length } });

  // template: every day of the week
  const rows: any[] = [];
  const add = (group: string, shiftCode: string, target: number, min = target, max: number | null = target) => {
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++)
      rows.push({ scope: 'TEMPLATE', weekStart: '', group, shiftCode, dayOfWeek, minCount: min, targetCount: target, maxCount: max });
  };
  add('MIRAKL', '07:00', 3);
  add('MIRAKL', '12:30', 2);
  add('EGAIN_DEB', '08:00', 4, 3, null);
  add('EGAIN_DEB', '22:00', 2, 2, null);
  add('SENT_DEB', '09:00', 4, 3, null);
  add('SENT_DEB', '12:30', 2, 2, null);
  add('EGAIN_KM', '09:00', 2);
  add('SENT_KM', '11:30', 2);
  await Requirement.insertMany(rows);
  void ADVISOR_SHIFTS; void reqKey;
  console.log(`Seeded ${people.length} people in ${teams.length} teams and ${rows.length} requirement rows.`);
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
