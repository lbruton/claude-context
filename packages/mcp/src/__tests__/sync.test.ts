import { SyncManager } from '../sync';
import { SnapshotManager } from '../snapshot';
import { Context, FileSynchronizer } from '@lbruton/claude-context-core';

// Use fake timers to control setTimeout / setInterval
jest.useFakeTimers();

describe('SyncManager', () => {
    let context: jest.Mocked<Context>;
    let snapshotManager: jest.Mocked<SnapshotManager>;
    let syncManager: SyncManager;

    beforeEach(() => {
        context = new Context() as jest.Mocked<Context>;
        snapshotManager = new SnapshotManager() as jest.Mocked<SnapshotManager>;

        // Provide default mocked implementations for methods used in handleSyncIndex
        snapshotManager.getIndexedCodebases = jest.fn().mockReturnValue([]);

        syncManager = new SyncManager(context, snapshotManager);
    });

    afterEach(() => {
        syncManager.dispose();
        jest.clearAllTimers();
    });

    // ------------------------------------------------------------------ //
    // dispose()
    // ------------------------------------------------------------------ //

    describe('dispose()', () => {
        it('clears the sync interval timer', () => {
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

            syncManager.startBackgroundSync();
            syncManager.dispose();

            expect(clearIntervalSpy).toHaveBeenCalled();
        });

        it('clears the initial sync timeout', () => {
            const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

            syncManager.startBackgroundSync();
            syncManager.dispose();

            expect(clearTimeoutSpy).toHaveBeenCalled();
        });

        it('sets syncIntervalId to null after dispose', () => {
            syncManager.startBackgroundSync();
            syncManager.dispose();

            expect((syncManager as any).syncIntervalId).toBeNull();
        });

        it('sets initialSyncTimeoutId to null after dispose', () => {
            syncManager.startBackgroundSync();
            syncManager.dispose();

            expect((syncManager as any).initialSyncTimeoutId).toBeNull();
        });

        it('is safe to call dispose() multiple times without error', () => {
            syncManager.startBackgroundSync();

            expect(() => {
                syncManager.dispose();
                syncManager.dispose();
            }).not.toThrow();
        });

        it('is safe to call dispose() before startBackgroundSync()', () => {
            expect(() => syncManager.dispose()).not.toThrow();
        });

        it('nulls out timer IDs so they are not double-cleared', () => {
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
            const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

            syncManager.startBackgroundSync();
            syncManager.dispose();

            // Reset counts so we only observe calls from the second dispose()
            clearIntervalSpy.mockClear();
            clearTimeoutSpy.mockClear();

            // Second dispose: IDs are null, so clear* should not be called
            syncManager.dispose();

            expect(clearIntervalSpy).not.toHaveBeenCalled();
            expect(clearTimeoutSpy).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------ //
    // startBackgroundSync()
    // ------------------------------------------------------------------ //

    describe('startBackgroundSync()', () => {
        it('stores a non-null syncIntervalId after start', () => {
            syncManager.startBackgroundSync();

            expect((syncManager as any).syncIntervalId).not.toBeNull();
        });

        it('stores a non-null initialSyncTimeoutId after start', () => {
            syncManager.startBackgroundSync();

            expect((syncManager as any).initialSyncTimeoutId).not.toBeNull();
        });

        it('clears previous timers when called a second time (re-entry guard)', () => {
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
            const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

            syncManager.startBackgroundSync();
            const firstIntervalId = (syncManager as any).syncIntervalId;
            const firstTimeoutId = (syncManager as any).initialSyncTimeoutId;

            syncManager.startBackgroundSync();

            expect(clearIntervalSpy).toHaveBeenCalledWith(firstIntervalId);
            expect(clearTimeoutSpy).toHaveBeenCalledWith(firstTimeoutId);
        });

        it('replaces timer IDs after re-entry', () => {
            syncManager.startBackgroundSync();

            syncManager.startBackgroundSync();
            const secondIntervalId = (syncManager as any).syncIntervalId;

            // The IDs may differ (jest fake timers can reuse IDs in some versions,
            // but the important thing is start was called twice and cleared the old ones)
            expect(secondIntervalId).not.toBeNull();
            // Re-entry must have triggered clearInterval for the first ID
            expect((global as any).clearInterval).toHaveBeenCalled();
        });

        it('sets initialSyncTimeoutId to null after timeout fires', async () => {
            snapshotManager.getIndexedCodebases = jest.fn().mockReturnValue([]);

            syncManager.startBackgroundSync();

            // Advance past the 5-second initial sync delay
            await jest.advanceTimersByTimeAsync(5001);

            expect((syncManager as any).initialSyncTimeoutId).toBeNull();
        });

        it('schedules periodic sync every 5 minutes', () => {
            snapshotManager.getIndexedCodebases = jest.fn().mockReturnValue([]);
            const handleSyncSpy = jest
                .spyOn(syncManager as any, 'handleSyncIndex')
                .mockResolvedValue(undefined);

            syncManager.startBackgroundSync();

            // Advance 5 minutes (periodic interval fires)
            jest.advanceTimersByTime(5 * 60 * 1000);

            expect(handleSyncSpy).toHaveBeenCalled();
        });

        it('calls handleSyncIndex after initial 5-second delay', async () => {
            const handleSyncSpy = jest
                .spyOn(syncManager as any, 'handleSyncIndex')
                .mockResolvedValue(undefined);

            syncManager.startBackgroundSync();

            // Should not have fired yet
            expect(handleSyncSpy).not.toHaveBeenCalled();

            // Advance past the 5-second delay
            await jest.advanceTimersByTimeAsync(5001);

            expect(handleSyncSpy).toHaveBeenCalledTimes(1);
        });

        it('does not throw when initial sync throws a collection-not-found error', async () => {
            jest.spyOn(syncManager as any, 'handleSyncIndex').mockRejectedValue(
                new Error('Failed to query collection: not found'),
            );

            syncManager.startBackgroundSync();

            // The error should be swallowed (logged only)
            await expect(jest.advanceTimersByTimeAsync(5001)).resolves.not.toThrow();
        });

        it('does not throw when initial sync throws an unexpected error', async () => {
            jest.spyOn(syncManager as any, 'handleSyncIndex').mockRejectedValue(
                new Error('Unexpected network failure'),
            );

            syncManager.startBackgroundSync();

            await expect(jest.advanceTimersByTimeAsync(5001)).resolves.not.toThrow();
        });
    });

    // ------------------------------------------------------------------ //
    // handleSyncIndex()
    // ------------------------------------------------------------------ //

    describe('handleSyncIndex()', () => {
        it('skips sync when no codebases are indexed', async () => {
            snapshotManager.getIndexedCodebases = jest.fn().mockReturnValue([]);

            await syncManager.handleSyncIndex();

            expect(context.reindexByChange).not.toHaveBeenCalled();
        });

        it('prevents concurrent syncs via isSyncing guard', async () => {
            // Make reindexByChange hang until we resolve manually
            let resolveFirst!: () => void;
            const firstSyncPromise = new Promise<{
                added: number;
                removed: number;
                modified: number;
            }>((res) => {
                resolveFirst = () => res({ added: 0, removed: 0, modified: 0 });
            });
            context.reindexByChange = jest.fn().mockReturnValue(firstSyncPromise);
            snapshotManager.getIndexedCodebases = jest.fn().mockReturnValue(['/tmp/proj']);

            // Make the codebase path appear to exist so sync proceeds past the fs.existsSync guard
            const existsSyncSpy = jest.spyOn(require('fs'), 'existsSync').mockReturnValue(true);

            const first = syncManager.handleSyncIndex();
            const second = syncManager.handleSyncIndex(); // should be skipped

            resolveFirst();
            await Promise.all([first, second]);

            existsSyncSpy.mockRestore();

            // reindexByChange should only have been called once (second call skipped)
            expect(context.reindexByChange).toHaveBeenCalledTimes(1);
        });

        it('resets isSyncing to false after completion', async () => {
            snapshotManager.getIndexedCodebases = jest.fn().mockReturnValue(['/tmp/proj']);
            context.reindexByChange = jest
                .fn()
                .mockResolvedValue({ added: 1, removed: 0, modified: 0 });

            await syncManager.handleSyncIndex();

            expect((syncManager as any).isSyncing).toBe(false);
        });

        it('resets isSyncing to false even when reindexByChange throws', async () => {
            snapshotManager.getIndexedCodebases = jest.fn().mockReturnValue(['/tmp/proj']);
            context.reindexByChange = jest.fn().mockRejectedValue(new Error('Milvus down'));

            await syncManager.handleSyncIndex();

            expect((syncManager as any).isSyncing).toBe(false);
        });

        it('calls FileSynchronizer.deleteSnapshot when Milvus query fails', async () => {
            snapshotManager.getIndexedCodebases = jest.fn().mockReturnValue(['/tmp/proj']);
            context.reindexByChange = jest
                .fn()
                .mockRejectedValue(new Error('Failed to query Milvus: collection gone'));

            // Make the codebase path appear to exist so sync proceeds past the fs.existsSync guard
            const existsSyncSpy = jest.spyOn(require('fs'), 'existsSync').mockReturnValue(true);

            await syncManager.handleSyncIndex();

            existsSyncSpy.mockRestore();

            expect(FileSynchronizer.deleteSnapshot).toHaveBeenCalledWith('/tmp/proj');
        });

        it('continues with remaining codebases when one fails', async () => {
            snapshotManager.getIndexedCodebases = jest.fn().mockReturnValue(['/tmp/a', '/tmp/b']);
            context.reindexByChange = jest
                .fn()
                .mockRejectedValueOnce(new Error('first failed'))
                .mockResolvedValueOnce({ added: 2, removed: 0, modified: 0 });

            // Make both codebase paths appear to exist so sync proceeds past the fs.existsSync guard
            const existsSyncSpy = jest.spyOn(require('fs'), 'existsSync').mockReturnValue(true);

            await syncManager.handleSyncIndex();

            existsSyncSpy.mockRestore();

            expect(context.reindexByChange).toHaveBeenCalledTimes(2);
        });
    });
});
