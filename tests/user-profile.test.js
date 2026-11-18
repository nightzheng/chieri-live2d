'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const profile = require('../js/user-profile');

test('user profile accepts optional nicknames and calendar-valid month/day values', () => {
  assert.equal(profile.name('  小林\n  '), '小林');
  assert.equal(profile.name('A'.repeat(40)).length, 32);
  assert.equal(profile.birthday('02-29'), '02-29');
  for (const invalid of ['', '2000-02-29', '02-30', '04-31', '13-01', '02-00']) {
    assert.equal(profile.birthday(invalid), '');
  }
});

test('birthdays match the local calendar, including leap day', () => {
  assert.equal(profile.isBirthday('02-29', new Date(2028, 1, 29, 23, 59)), true);
  assert.equal(profile.isBirthday('02-29', new Date(2027, 1, 28)), false);
  assert.equal(profile.isBirthday('02-29', new Date(2028, 2, 1)), false);
});
