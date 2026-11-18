'use strict';

const UserProfile = {
  name(value) {
    return typeof value === 'string' ? value.replace(/\p{Cc}/gu, '').trim().slice(0, 32) : '';
  },
  birthday(value) {
    if (typeof value !== 'string' || !/^\d{2}-\d{2}$/.test(value)) return '';
    const [month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(2000, month - 1, day));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : '';
  },
  isBirthday(value, today = new Date()) {
    const key = [today.getMonth() + 1, today.getDate()].map(part => String(part).padStart(2, '0')).join('-');
    return value === key;
  },
};

if (typeof module !== 'undefined') module.exports = UserProfile;
