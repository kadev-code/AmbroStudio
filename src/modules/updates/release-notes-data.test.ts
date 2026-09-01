import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';
import { RELEASE_NOTES } from './release-notes-data';

function versionParts(version: string) {
  return version.split('.').map(Number);
}

describe('RELEASE_NOTES', () => {
  it('keeps the installed version as the most recent entry', () => {
    expect(RELEASE_NOTES[0]?.version).toBe(packageJson.version);
  });

  it('has unique versions in descending order', () => {
    const versions = RELEASE_NOTES.map(({ version }) => version);
    expect(new Set(versions).size).toBe(versions.length);

    for (let index = 1; index < versions.length; index += 1) {
      const previous = versionParts(versions[index - 1]);
      const current = versionParts(versions[index]);
      const descending = previous.some((part, partIndex) => {
        if (part === current[partIndex]) return false;
        return part > current[partIndex];
      });
      expect(descending).toBe(true);
    }
  });

  it('explains the reason, changes and usage of every release', () => {
    for (const release of RELEASE_NOTES) {
      expect(release.title.trim()).not.toBe('');
      expect(release.summary.trim()).not.toBe('');
      expect(release.reason.trim()).not.toBe('');
      expect(release.changes.length).toBeGreaterThan(0);
      expect(release.howToUse.length).toBeGreaterThan(0);
    }
  });
});
