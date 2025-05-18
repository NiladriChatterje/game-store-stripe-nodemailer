function partition(arr: number[], l: number, r: number) {

    const pivot: number = Math.trunc((l + r) / 2);

    [arr[l], arr[pivot]] = [arr[pivot], arr[l]];
    l++;

    while (l < r) {
        while (arr[l] < arr[pivot])
            l++;

        while (arr[r] > arr[pivot])
            r--;

        if (l <= r) {
            [arr[l], arr[r]] = [arr[r], arr[l]];
            l++;
            r--;
        }
    }

    [arr[l], arr[r]] = [arr[r], arr[l]];
    return l;
}

function quickMerge(vectors: number[], l: number = 0, r: number = vectors.length - 1) {
    if (l >= r)
        return;

    let latestPivot = partition(vectors, l, r);

    quickMerge(vectors, l, latestPivot - 1);
    quickMerge(vectors, latestPivot + 1, r);
}

export function knn(vectorEmbeddings: number[][], query: number[], k: number = Math.trunc(vectorEmbeddings.length / 2)): number[] {
    const result: number[] = [];
    for (let vector of vectorEmbeddings)
        result.push(Math.sqrt(vector.reduce((prev, curr, i) => prev + (curr - query[i]) * (curr - query[i])
            , 0)));

    quickMerge(result);

    return result;
}

console.log(knn([[4, 3], [12, 5], [12, 12], [12, 25], [23, 25]], [4, 8]))