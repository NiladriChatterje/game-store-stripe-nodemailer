function partition(arr: [string, number][], l: number, r: number) {

    const pivot: number = Math.trunc((l + r) / 2);

    [arr[l], arr[pivot]] = [arr[pivot], arr[l]];
    l++;

    while (l < r) {
        while (arr[l][1] < arr[pivot][1])
            l++;

        while (arr[r][1] > arr[pivot][1])
            r--;

        if (l <= r) {
            [arr[l], arr[r]] = [arr[r], arr[l]];
            l++;
            r--;
        }
    }

    // [arr[l], arr[r]] = [arr[r], arr[l]];
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
    const vectorEmbeddingsMorphed: [string, number[]][] = [];

    for (let productKey in vectorEmbeddings)
        vectorEmbeddingsMorphed.push(vectorEmbeddings[productKey]);

    const result: [string, number][] = [];
    let dist;
    for (let vector of vectorEmbeddingsMorphed) {
        dist = Math.sqrt(vector[1].reduce((acc, curr, i) => (acc + (curr - query[i]) * (curr - query[i])), 0));
        result.push([vector[0], dist])
    }

    quickMerge(result);
    // result.sort((a, b) => a[1] - b[1])

    return result;
}

console.log(knn([["6", [28, 3]], ["23", [12, 5]], ["3", [12, 12]], ["14", [12, 25]],
["5", [23, 25]]], [4, 8]))