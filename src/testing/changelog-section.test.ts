import { describe, expect, it } from 'vitest'
import { changelogSection } from '../../scripts/changelog-section.mjs'

// A CHANGELOG.md after a stable release and a later beta were folded.
const CHANGELOG = `# Changelog

All notable changes to que are recorded here.

## [Unreleased]

## [0.2.0-beta.1] - 2026-10-28

### Added

- A Files tab in the review pane.

## [0.2.0] - 2026-10-21

### Added

- \`que ws diff --base <ref>\` compares against another ref.

### Fixed

- The sidebar keeps sessions when the daemon is older than the app.

## [0.1.0] - 2026-10-14

### Added

- Quiet mode: quiet hours enforced by the daemon.

[Unreleased]: https://github.com/rquellh/que/compare/v0.2.0-beta.1...HEAD
[0.2.0-beta.1]: https://github.com/rquellh/que/compare/v0.2.0...v0.2.0-beta.1
[0.2.0]: https://github.com/rquellh/que/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rquellh/que/releases/tag/v0.1.0
`

describe('changelogSection', () => {
  describe('finding the section', () => {
    it('returns the notes under the version, without its heading, up to the next version', () => {
      expect(changelogSection(CHANGELOG, '0.2.0')).toBe(
        [
          '### Added',
          '',
          '- `que ws diff --base <ref>` compares against another ref.',
          '',
          '### Fixed',
          '',
          '- The sidebar keeps sessions when the daemon is older than the app.'
        ].join('\n')
      )
    })

    it('finds a prerelease section by its full version', () => {
      expect(changelogSection(CHANGELOG, '0.2.0-beta.1')).toBe(
        '### Added\n\n- A Files tab in the review pane.'
      )
    })

    it('leaves the link definitions out of the last section', () => {
      expect(changelogSection(CHANGELOG, '0.1.0')).toBe(
        '### Added\n\n- Quiet mode: quiet hours enforced by the daemon.'
      )
    })

    it('reads a file with CRLF line endings', () => {
      expect(changelogSection(CHANGELOG.replaceAll('\n', '\r\n'), '0.2.0-beta.1')).toBe(
        '### Added\n\n- A Files tab in the review pane.'
      )
    })
  })

  describe('missing notes', () => {
    it('finds nothing for a version with no section', () => {
      expect(changelogSection(CHANGELOG, '0.3.0')).toBeUndefined()
    })

    it('does not take a prerelease section for its stable version', () => {
      const betaOnly = CHANGELOG.replace(/## \[0\.2\.0\] - [\s\S]*?(?=## \[0\.1\.0\])/, '')

      expect(changelogSection(betaOnly, '0.2.0')).toBeUndefined()
    })

    it('finds nothing for an empty section, such as an unfolded Unreleased', () => {
      expect(changelogSection(CHANGELOG, 'Unreleased')).toBeUndefined()
    })
  })
})
