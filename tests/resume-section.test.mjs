import assert from 'node:assert/strict';
import test from 'node:test';
import { extractResumeSection } from '../scripts/approved-lib.mjs';
import { normalizeForMatch } from '../scripts/lib.mjs';

const RESUME = [
  '# Name',
  '',
  '## PROFILE',
  '',
  'I am a designer with more than 15 years of experience.',
  '',
  '---',
  '',
  '## Selected Highlights',
  '',
  '### [Linked Highlight:](https://example.test/a)',
  '',
  'Designed a prototype in 8 days.',
  '',
  '- Its model became the basis of the product.',
  '',
  '### Second Highlight:',
  '',
  'Directed a broadcast.',
  '',
  '* Reached 4M viewers.',
  '',
  '### Third Highlight:',
  '',
  '#### Card Title',
  '',
  'Built a system.',
  '',
  '1. Used on all client work.',
  '',
  '## Next',
].join('\n');

test('a horizontal rule after the section is not part of the text', () => {
  assert.equal(extractResumeSection(RESUME, '## PROFILE'), 'I am a designer with more than 15 years of experience.');
});

test('list markers are dropped so bullets read as running sentences', () => {
  const text = extractResumeSection(RESUME, '### [Linked Highlight:](https://example.test/a)');
  assert.equal(normalizeForMatch(text), 'Designed a prototype in 8 days. Its model became the basis of the product.');
  assert.equal(normalizeForMatch(extractResumeSection(RESUME, '### Second Highlight:')), 'Directed a broadcast. Reached 4M viewers.');
});

test('a level-4 card ends at the next heading of the same or higher level', () => {
  assert.equal(normalizeForMatch(extractResumeSection(RESUME, '#### Card Title')), 'Built a system. Used on all client work.');
});
