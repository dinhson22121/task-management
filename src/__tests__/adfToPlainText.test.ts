import { adfToPlainText } from '../services/jiraClient';

describe('adfToPlainText', () => {
  it('returns null for a null/non-object doc', () => {
    expect(adfToPlainText(null)).toBeNull();
    expect(adfToPlainText(undefined)).toBeNull();
    expect(adfToPlainText('plain string')).toBeNull();
  });

  it('extracts text from a single paragraph', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
    };
    expect(adfToPlainText(doc)).toBe('Hello world');
  });

  it('joins multiple paragraphs with newlines', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
      ],
    };
    expect(adfToPlainText(doc)).toBe('First line\nSecond line');
  });

  it('concatenates nested marked text runs within a paragraph', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bold ', marks: [{ type: 'strong' }] },
            { type: 'text', text: 'and plain' },
          ],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('Bold and plain');
  });

  it('handles headings alongside paragraphs', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
      ],
    };
    expect(adfToPlainText(doc)).toBe('Title\nBody');
  });

  it('returns null for an empty document', () => {
    expect(adfToPlainText({ type: 'doc', content: [] })).toBeNull();
  });
});
