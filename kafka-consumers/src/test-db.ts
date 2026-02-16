import mysql from 'mysql2/promise';

async function test() {
    try {
        console.log("Attempting to connect to global_sql_data:3306...");
        const connection = await mysql.createConnection({
            host: 'global_sql_data',
            port: 3306,
            user: 'root',
            database: 'xvstore'
        });
        console.log("Connected successfully!");
        await connection.end();
    } catch (err) {
        console.error("Connection failed:", err);
    }
}

test();
