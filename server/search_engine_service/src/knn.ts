function partition(arr: [string, number][], l: number, r: number) {

    const pivot: number = Math.trunc((l + r) / 2);

    [arr[1][l], arr[1][pivot]] = [arr[1][pivot], arr[1][l]];
    l++;

    while (l < r) {
        while (arr[1][l] < arr[1][pivot])
            l++;

        while (arr[1][r] > arr[1][pivot])
            r--;

        if (l <= r) {
            [arr[1][l], arr[1][r]] = [arr[1][r], arr[1][l]];
            l++;
            r--;
        }
    }

    [arr[1][l], arr[1][r]] = [arr[1][r], arr[1][l]];
    return l;
}

function quickMerge(vectors: [string, number][], l: number = 0, r: number = vectors.length - 1) {
    if (l >= r)
        return;

    let latestPivot = partition(vectors, l, r);

    quickMerge(vectors, l, latestPivot - 1);
    quickMerge(vectors, latestPivot + 1, r);
}

export function knn(vectorEmbeddings: Map<{ toString: {}; }, { toString: {}; }> | {
    toString: {};
}[], query: number[], k: number = 10): [string, number][] {
    let vectorEmbeddingsMorphed: [string, number[]][];

    for (let productKey in vectorEmbeddings)
        vectorEmbeddingsMorphed.push([productKey, vectorEmbeddings[productKey]]);

    const result: [string, number][] = [];
    let dist;
    for (let vector of vectorEmbeddingsMorphed) {
        dist = Math.sqrt(vector[1].reduce((acc, curr, i) => (acc + (curr[i] - query[i]) * (curr[i] - query[i])), 0));
        result.push([vector[0], dist])
    }

    quickMerge(result);

    return result;
}

console.log(knn([[4, 3], [12, 5], [12, 12], [12, 25], [23, 25]], [4, 8]))