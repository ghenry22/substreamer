import { isAutoplaySectionStart } from '../queueOrigins';

it('marks only the first upcoming autoplay row', () => {
  const origins = ['manual', 'manual', 'autoplay', 'autoplay'] as const;
  expect(isAutoplaySectionStart(origins, 1, 2)).toBe(true);
  expect(isAutoplaySectionStart(origins, 1, 3)).toBe(false);
});

it('does not mark autoplay rows already in playback history', () => {
  expect(isAutoplaySectionStart(['manual', 'autoplay', 'autoplay'], 2, 1)).toBe(false);
});

it('supports an autoplay queue before a current track is selected', () => {
  expect(isAutoplaySectionStart(['autoplay'], null, 0)).toBe(true);
});
