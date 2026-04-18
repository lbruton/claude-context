/**
 * Mock for @lbruton/claude-context-core to avoid workspace resolution
 * issues during unit testing of the MCP package.
 */

export const envManager = {
    get: jest.fn((key: string) => undefined as string | undefined),
};

export class Context {
    hasIndex = jest.fn().mockResolvedValue(false);
    indexCodebase = jest.fn().mockResolvedValue({ indexedFiles: 0, totalChunks: 0 });
    semanticSearch = jest.fn().mockResolvedValue([]);
    clearIndex = jest.fn().mockResolvedValue(undefined);
    reindexByChange = jest.fn().mockResolvedValue({ added: 0, removed: 0, modified: 0 });
    getVectorDatabase = jest.fn().mockReturnValue({
        listCollections: jest.fn().mockResolvedValue([]),
        getCollectionDescription: jest.fn().mockResolvedValue(''),
        query: jest.fn().mockResolvedValue([]),
    });
}

export class FileSynchronizer {
    static deleteSnapshot = jest.fn().mockResolvedValue(undefined);
}

export const COLLECTION_LIMIT_MESSAGE = 'Collection limit reached';