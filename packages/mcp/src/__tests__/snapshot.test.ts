import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SnapshotManager } from '../snapshot';

// Helper to override the private snapshotFilePath for testing
function setSnapshotFilePath(manager: SnapshotManager, filePath: string): void {
    (manager as any).snapshotFilePath = filePath;
}

describe('SnapshotManager', () => {
    let tmpDir: string;
    let snapshotFile: string;
    let manager: SnapshotManager;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-test-'));
        snapshotFile = path.join(tmpDir, 'test-snapshot.json');
        manager = new SnapshotManager();
        setSnapshotFilePath(manager, snapshotFile);
    });

    afterEach(() => {
        // Release any stale lock that tests may have left behind
        const lockPath = snapshotFile + '.lock';
        try {
            fs.rmdirSync(lockPath);
        } catch {
            /* already gone */
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ------------------------------------------------------------------ //
    // saveCodebaseSnapshot
    // ------------------------------------------------------------------ //

    describe('saveCodebaseSnapshot()', () => {
        it('saves an empty snapshot in v2 format', async () => {
            await manager.saveCodebaseSnapshot();

            const data = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
            expect(data.formatVersion).toBe('v2');
            expect(data.codebases).toEqual({});
            expect(typeof data.lastUpdated).toBe('string');
        });

        it('persists an indexed codebase', async () => {
            manager.setCodebaseIndexed('/tmp/my-project', {
                indexedFiles: 10,
                totalChunks: 50,
                status: 'completed',
            });

            await manager.saveCodebaseSnapshot();

            const data = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
            expect(data.formatVersion).toBe('v2');
            expect(data.codebases['/tmp/my-project']).toMatchObject({
                status: 'indexed',
                indexedFiles: 10,
                totalChunks: 50,
                indexStatus: 'completed',
            });
        });

        it('persists an indexing codebase with progress', async () => {
            manager.setCodebaseIndexing('/tmp/project-b', 42);

            await manager.saveCodebaseSnapshot();

            const data = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
            expect(data.codebases['/tmp/project-b']).toMatchObject({
                status: 'indexing',
                indexingPercentage: 42,
            });
        });

        it('persists a failed codebase with error info', async () => {
            manager.setCodebaseIndexFailed('/tmp/broken', 'Out of memory', 33.5);

            await manager.saveCodebaseSnapshot();

            const data = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
            expect(data.codebases['/tmp/broken']).toMatchObject({
                status: 'indexfailed',
                errorMessage: 'Out of memory',
                lastAttemptedPercentage: 33.5,
            });
        });

        it('throws an error when the lock cannot be acquired', async () => {
            // Pre-create a fresh lock directory so acquireLock always sees it
            const lockPath = snapshotFile + '.lock';
            fs.mkdirSync(path.dirname(lockPath), { recursive: true });
            fs.mkdirSync(lockPath);

            // Make the lock appear fresh so the stale-lock branch is not hit
            // by touching it right now (mtime is very recent)
            // acquireLock will exhaust its retries and return false
            await expect(manager.saveCodebaseSnapshot()).rejects.toThrow(
                'Failed to acquire snapshot lock after retries',
            );

            // Clean up lock
            fs.rmdirSync(lockPath);
        });

        it('releases the lock after a successful save', async () => {
            await manager.saveCodebaseSnapshot();

            const lockPath = snapshotFile + '.lock';
            expect(fs.existsSync(lockPath)).toBe(false);
        });

        it('releases the lock even when write throws', async () => {
            // Make snapshotFilePath an unwritable path to force an error
            // by pointing it to a directory instead of a file
            const badFile = path.join(tmpDir, 'is-a-dir');
            fs.mkdirSync(badFile);
            setSnapshotFilePath(manager, badFile);

            const lockPath = badFile + '.lock';

            await expect(manager.saveCodebaseSnapshot()).rejects.toThrow();

            // Lock must be released even after the error
            expect(fs.existsSync(lockPath)).toBe(false);
        });

        it('merges entries from disk that are not in memory', async () => {
            // Write an existing v2 snapshot on disk with an entry
            const diskEntry = {
                formatVersion: 'v2',
                codebases: {
                    '/tmp/disk-only': {
                        status: 'indexed',
                        indexedFiles: 5,
                        totalChunks: 20,
                        indexStatus: 'completed',
                        lastUpdated: new Date().toISOString(),
                    },
                },
                lastUpdated: new Date().toISOString(),
            };
            fs.writeFileSync(snapshotFile, JSON.stringify(diskEntry));

            // In-memory manager knows about a different codebase
            manager.setCodebaseIndexed('/tmp/mem-only', {
                indexedFiles: 3,
                totalChunks: 9,
                status: 'completed',
            });

            await manager.saveCodebaseSnapshot();

            const data = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
            // Both entries should be present after merge
            expect(data.codebases['/tmp/disk-only']).toBeDefined();
            expect(data.codebases['/tmp/mem-only']).toBeDefined();
        });

        it('does not re-add recently removed codebases from disk', async () => {
            // Pre-populate disk with an entry
            const diskEntry = {
                formatVersion: 'v2',
                codebases: {
                    '/tmp/was-removed': {
                        status: 'indexed',
                        indexedFiles: 1,
                        totalChunks: 2,
                        indexStatus: 'completed',
                        lastUpdated: new Date().toISOString(),
                    },
                },
                lastUpdated: new Date().toISOString(),
            };
            fs.writeFileSync(snapshotFile, JSON.stringify(diskEntry));

            manager.removeCodebaseCompletely('/tmp/was-removed');

            await manager.saveCodebaseSnapshot();

            const data = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
            expect(data.codebases['/tmp/was-removed']).toBeUndefined();
        });
    });

    // ------------------------------------------------------------------ //
    // loadCodebaseSnapshot
    // ------------------------------------------------------------------ //

    describe('loadCodebaseSnapshot()', () => {
        it('starts with empty state when snapshot file does not exist', async () => {
            await manager.loadCodebaseSnapshot();

            expect(manager.getIndexedCodebases()).toEqual([]);
            expect(manager.getIndexingCodebases()).toEqual([]);
        });

        it('loads a v2 snapshot and restores indexed codebases', async () => {
            const codebasePath = tmpDir; // use tmpDir so fs.existsSync returns true
            const v2Data = {
                formatVersion: 'v2',
                codebases: {
                    [codebasePath]: {
                        status: 'indexed',
                        indexedFiles: 7,
                        totalChunks: 35,
                        indexStatus: 'completed',
                        lastUpdated: new Date().toISOString(),
                    },
                },
                lastUpdated: new Date().toISOString(),
            };
            fs.writeFileSync(snapshotFile, JSON.stringify(v2Data));

            await manager.loadCodebaseSnapshot();

            expect(manager.getCodebaseStatus(codebasePath)).toBe('indexed');
            const info = manager.getCodebaseInfo(codebasePath) as any;
            expect(info.indexedFiles).toBe(7);
            expect(info.totalChunks).toBe(35);
        });

        it('loads a v2 snapshot and resets interrupted indexing to failed', async () => {
            const codebasePath = tmpDir;
            const v2Data = {
                formatVersion: 'v2',
                codebases: {
                    [codebasePath]: {
                        status: 'indexing',
                        indexingPercentage: 55,
                        lastUpdated: new Date().toISOString(),
                    },
                },
                lastUpdated: new Date().toISOString(),
            };
            fs.writeFileSync(snapshotFile, JSON.stringify(v2Data));

            await manager.loadCodebaseSnapshot();

            // Interrupted indexing should be reset to failed
            expect(manager.getCodebaseStatus(codebasePath)).toBe('indexfailed');
            const info = manager.getCodebaseInfo(codebasePath) as any;
            expect(info.errorMessage).toMatch(/interrupted/i);
        });

        it('loads a v2 snapshot and keeps failed codebase info', async () => {
            const codebasePath = tmpDir;
            const v2Data = {
                formatVersion: 'v2',
                codebases: {
                    [codebasePath]: {
                        status: 'indexfailed',
                        errorMessage: 'Connection refused',
                        lastAttemptedPercentage: 10,
                        lastUpdated: new Date().toISOString(),
                    },
                },
                lastUpdated: new Date().toISOString(),
            };
            fs.writeFileSync(snapshotFile, JSON.stringify(v2Data));

            await manager.loadCodebaseSnapshot();

            expect(manager.getCodebaseStatus(codebasePath)).toBe('indexfailed');
            const info = manager.getCodebaseInfo(codebasePath) as any;
            expect(info.errorMessage).toBe('Connection refused');
        });

        it('loads a v1 snapshot, migrates to v2, and saves', async () => {
            const codebasePath = tmpDir; // must exist for validation
            const v1Data = {
                indexedCodebases: [codebasePath],
                indexingCodebases: [],
                lastUpdated: new Date().toISOString(),
            };
            fs.writeFileSync(snapshotFile, JSON.stringify(v1Data));

            await manager.loadCodebaseSnapshot();

            // After load + migration save, file should be in v2 format
            const savedData = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
            expect(savedData.formatVersion).toBe('v2');
            expect(manager.getCodebaseStatus(codebasePath)).toBe('indexed');
        });

        it('skips v1 codebases that no longer exist on disk', async () => {
            const v1Data = {
                indexedCodebases: ['/nonexistent/path/to/project'],
                indexingCodebases: [],
                lastUpdated: new Date().toISOString(),
            };
            fs.writeFileSync(snapshotFile, JSON.stringify(v1Data));

            await manager.loadCodebaseSnapshot();

            expect(manager.getIndexedCodebases()).not.toContain('/nonexistent/path/to/project');
        });

        it('skips v2 codebases that no longer exist on disk', async () => {
            const v2Data = {
                formatVersion: 'v2',
                codebases: {
                    '/nonexistent/gone': {
                        status: 'indexed',
                        indexedFiles: 1,
                        totalChunks: 5,
                        indexStatus: 'completed',
                        lastUpdated: new Date().toISOString(),
                    },
                },
                lastUpdated: new Date().toISOString(),
            };
            fs.writeFileSync(snapshotFile, JSON.stringify(v2Data));

            await manager.loadCodebaseSnapshot();

            expect(manager.getCodebaseStatus('/nonexistent/gone')).toBe('not_found');
        });

        it('handles corrupt snapshot file gracefully', async () => {
            fs.writeFileSync(snapshotFile, 'not valid json {{{{');

            // Should not throw; starts with empty state
            await expect(manager.loadCodebaseSnapshot()).resolves.not.toThrow();
            expect(manager.getIndexedCodebases()).toEqual([]);
        });

        it('saves in v2 format after loading (migration trigger)', async () => {
            // Write v1 format
            const codebasePath = tmpDir;
            const v1Data = {
                indexedCodebases: [codebasePath],
                indexingCodebases: {},
                lastUpdated: new Date().toISOString(),
            };
            fs.writeFileSync(snapshotFile, JSON.stringify(v1Data));

            await manager.loadCodebaseSnapshot();

            // The file must now be in v2 format
            const reloaded = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
            expect(reloaded.formatVersion).toBe('v2');
        });
    });

    // ------------------------------------------------------------------ //
    // acquireLock (tested indirectly through saveCodebaseSnapshot)
    // ------------------------------------------------------------------ //

    describe('acquireLock() via saveCodebaseSnapshot()', () => {
        it('removes a stale lock (>10 seconds old) and proceeds', async () => {
            const lockPath = snapshotFile + '.lock';
            fs.mkdirSync(path.dirname(lockPath), { recursive: true });
            fs.mkdirSync(lockPath);

            // Back-date the lock by modifying mtime to be 15 seconds ago
            const staleTime = new Date(Date.now() - 15000);
            fs.utimesSync(lockPath, staleTime, staleTime);

            // saveCodebaseSnapshot should succeed after removing the stale lock
            await expect(manager.saveCodebaseSnapshot()).resolves.not.toThrow();
        });

        it('acquires lock concurrently — second call waits for first', async () => {
            // Run two concurrent saves; both should ultimately succeed
            const p1 = manager.saveCodebaseSnapshot();
            const p2 = manager.saveCodebaseSnapshot();

            await expect(Promise.all([p1, p2])).resolves.toBeDefined();
        });
    });

    // ------------------------------------------------------------------ //
    // State management methods (affected by async save in this PR)
    // ------------------------------------------------------------------ //

    describe('state management methods', () => {
        it('setCodebaseIndexing() marks codebase as indexing', () => {
            manager.setCodebaseIndexing('/tmp/proj', 25);

            expect(manager.getCodebaseStatus('/tmp/proj')).toBe('indexing');
            const info = manager.getCodebaseInfo('/tmp/proj') as any;
            expect(info.indexingPercentage).toBe(25);
        });

        it('setCodebaseIndexed() marks codebase as indexed', () => {
            manager.setCodebaseIndexed('/tmp/proj', {
                indexedFiles: 20,
                totalChunks: 100,
                status: 'completed',
            });

            expect(manager.getCodebaseStatus('/tmp/proj')).toBe('indexed');
            const info = manager.getCodebaseInfo('/tmp/proj') as any;
            expect(info.indexedFiles).toBe(20);
            expect(info.totalChunks).toBe(100);
            expect(info.indexStatus).toBe('completed');
        });

        it('setCodebaseIndexFailed() marks codebase as failed', () => {
            manager.setCodebaseIndexFailed('/tmp/proj', 'Network error', 67.3);

            expect(manager.getCodebaseStatus('/tmp/proj')).toBe('indexfailed');
            const info = manager.getCodebaseInfo('/tmp/proj') as any;
            expect(info.errorMessage).toBe('Network error');
            expect(info.lastAttemptedPercentage).toBeCloseTo(67.3);
        });

        it('removeCodebaseCompletely() removes from all tracking', () => {
            manager.setCodebaseIndexed('/tmp/proj', {
                indexedFiles: 5,
                totalChunks: 25,
                status: 'completed',
            });
            manager.removeCodebaseCompletely('/tmp/proj');

            expect(manager.getCodebaseStatus('/tmp/proj')).toBe('not_found');
            expect(manager.getCodebaseInfo('/tmp/proj')).toBeUndefined();
        });

        it('getFailedCodebases() returns only failed codebases', () => {
            manager.setCodebaseIndexed('/tmp/ok', {
                indexedFiles: 1,
                totalChunks: 1,
                status: 'completed',
            });
            manager.setCodebaseIndexFailed('/tmp/bad', 'Error');

            const failed = manager.getFailedCodebases();
            expect(failed).toContain('/tmp/bad');
            expect(failed).not.toContain('/tmp/ok');
        });

        it('setCodebaseIndexed() removes codebase from indexing list', () => {
            manager.setCodebaseIndexing('/tmp/proj', 50);
            manager.setCodebaseIndexed('/tmp/proj', {
                indexedFiles: 10,
                totalChunks: 40,
                status: 'completed',
            });

            expect(manager.getIndexingCodebases()).not.toContain('/tmp/proj');
            expect(manager.getCodebaseStatus('/tmp/proj')).toBe('indexed');
        });

        it('setCodebaseIndexFailed() removes codebase from indexed list', () => {
            manager.setCodebaseIndexed('/tmp/proj', {
                indexedFiles: 10,
                totalChunks: 40,
                status: 'completed',
            });
            manager.setCodebaseIndexFailed('/tmp/proj', 'Something went wrong');

            expect(manager.getCodebaseStatus('/tmp/proj')).toBe('indexfailed');
        });

        it('getCodebaseStatus() returns not_found for unknown codebase', () => {
            expect(manager.getCodebaseStatus('/tmp/unknown')).toBe('not_found');
        });
    });
});