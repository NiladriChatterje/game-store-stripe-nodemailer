//test to see a demo for array storage (for product_id:string=> product_embedding:[])

import redis from 'redis'
async function main() {
    const obj = redis.createClient({ url: 'redis://localhost:6379/1' });
    await obj.connect();
    obj.hSet('test', 'key', JSON.stringify([4, 5, 6]));
    obj.hSet('test', 'key2', JSON.stringify([7, 8, 6]));

    const x = (await obj.hGetAll('test'));
    for (let i in x)
        console.log(i, x[i])
    obj.del('test');

    await obj.close()
}

main()