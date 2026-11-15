import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePeopleCsv } from '../src/lib/csv';

test('maps human-readable people CSV headers and team leader names', () => {
  const rows = parsePeopleCsv([
  'Full name,Designation,Team leader,E-mail Address,Team number,Classification',
  'Asha Rao,Team Leader,,asha.rao@example.com,12,Normal',
  'Dev Nair,Advisor,Asha Rao,dev.nair@example.com,,',
  ].join('\n'));

  assert.deepEqual(rows[0], {
    emailAddress: 'asha.rao@example.com',
    name: 'Asha Rao',
    designation: 'Team Leader',
    teamLeader: '',
    teamNumber: '12',
    classification: 'Normal',
  });
  assert.equal(rows[1].teamLeader, 'Asha Rao');
  assert.equal(rows[1].teamNumber, '');
  assert.equal(rows[1].emailAddress, 'dev.nair@example.com');
  assert.equal('segment' in rows[1], false);
});

test('supports quoted CSV cells and tab-separated spreadsheets', () => {
  const commaRows = parsePeopleCsv('Full name,Designation,Team leader,E-mail Address,Team number,Classification\n"Doe, Jane",QA,,jane@example.com,,');
  assert.equal(commaRows[0].name, 'Doe, Jane');

  const tabRows = parsePeopleCsv('Full name\tDesignation\tTeam leader\tE-mail Address\tTeam number\tClassification\nDev Nair\tAdvisor\tAsha Rao\tdev@example.com\t\t');
  assert.equal(tabRows[0].teamLeader, 'Asha Rao');
});
