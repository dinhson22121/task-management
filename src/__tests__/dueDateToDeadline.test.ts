import { dueDateToDeadline } from '../services/jiraClient';

describe('dueDateToDeadline', () => {
  it('combines a date-only string with the working hour end (minutes from midnight)', () => {
    const deadline = dueDateToDeadline('2026-07-10', 1020);
    expect(deadline.getFullYear()).toBe(2026);
    expect(deadline.getMonth()).toBe(6);
    expect(deadline.getDate()).toBe(10);
    expect(deadline.getHours()).toBe(17);
    expect(deadline.getMinutes()).toBe(0);
  });

  it('supports non-hour-aligned working end times', () => {
    const deadline = dueDateToDeadline('2026-01-01', 510);
    expect(deadline.getHours()).toBe(8);
    expect(deadline.getMinutes()).toBe(30);
  });
});
