export class ShardHelper {
    private static SHARD_COUNT = 4;

    private static getHashCode(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }

    /**
     * Determines the database shard host based on an input string (e.g., state, pincode, or ID).
     * @param input The string to hash (e.g. seller's state)
     * @returns The hostname of the shard (mysql1, mysql2, etc.)
     */
    public static getShardHost(input: string): string {
        const index = this.getHashCode(input) % this.SHARD_COUNT;
        return `mysql${index + 1}`;
    }
}
