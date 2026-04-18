import { Context } from '../context';

describe('getIgnorePatternsFromFile', () => {
    const tmpDir = '/tmp/claude-context-test-ignore';
    const fs = require('fs');

    beforeEach(() => {
        fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('preserves negation patterns from .gitignore', async () => {
        const gitignorePath = `${tmpDir}/.gitignore`;
        fs.writeFileSync(
            gitignorePath,
            ['# comments ignored', '*.log', '!important.log', 'dist/', ''].join('\n'),
        );

        const patterns = await Context.getIgnorePatternsFromFile(gitignorePath);

        expect(patterns).toContain('*.log');
        expect(patterns).toContain('!important.log');
        expect(patterns).toContain('dist/');
        expect(patterns).not.toContain('# comments ignored');
        expect(patterns).not.toContain('');
    });

    it('returns empty array for missing file', async () => {
        const patterns = await Context.getIgnorePatternsFromFile(`${tmpDir}/nonexistent`);
        expect(patterns).toEqual([]);
    });
});

describe('ignore matcher with negation', () => {
    it('negation pattern re-includes previously ignored files', () => {
        const ignore = require('ignore');
        const ig = ignore();
        ig.add(['*.log', '!important.log', 'node_modules']);

        expect(ig.ignores('debug.log')).toBe(true);
        expect(ig.ignores('important.log')).toBe(false);
        expect(ig.ignores('node_modules/foo.js')).toBe(true);
        expect(ig.ignores('src/app.ts')).toBe(false);
    });

    it('negation ordering matters — last match wins', () => {
        const ignore = require('ignore');
        const ig = ignore();
        ig.add(['*.log', '!important.log', 'important.log']);

        // Re-ignored after negation
        expect(ig.ignores('important.log')).toBe(true);
    });
});
