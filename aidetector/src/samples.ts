/** Two samples: one written by a person, one with the tells stacked up. Both
 *  short, because the point is to show the reading, not to make you scroll. */
export const SAMPLES = [
  {
    name: 'generated',
    text:
      'Certainly! Acme Analytics, a vibrant startup nestled in the heart of a thriving tech ecosystem, has secured funding — marking a pivotal moment for the observability landscape. The platform serves as a unified hub, boasting sub-second queries and featuring a seamless integration layer. It is not just another monitoring tool, it is a paradigm shift. Moreover, experts believe the company is poised to disrupt the market. In order to fully leverage this momentum, the team plans to delve into new verticals. In conclusion, the future looks bright!',
  },
  {
    name: 'written',
    text:
      'We shipped the new query planner on Tuesday and it broke two customers by Thursday. Both were doing something we had told ourselves nobody does: filtering on a column that only exists in half the rows. The old planner tolerated it by accident. The fix took an afternoon. Deciding whether to keep tolerating it took a week, and we still argue about it at lunch.',
  },
];
