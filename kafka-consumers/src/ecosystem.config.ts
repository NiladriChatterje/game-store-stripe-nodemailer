export default {
    apps: [
        {
            name: 'add-product-consumer',
            script: 'npx',
            args: 'tsx ./AddProductConsumer.ts',
            autorestart: true,
            watch: false,
            cwd: './src',
            env: {
                NODE_ENV: 'production',
            },
        },
        {
            name: 'after-order-place-consumer',
            script: 'npx',
            args: 'tsx ./AfterOrderPlaceConsumer.ts',
            autoRestart: true,
            watch: false,
            cwd: './src',
            env: {
                NODE_ENV: 'production',
            },
        },
        {
            name: 'create-admin-consumer',
            script: 'npx',
            args: 'tsx ./CreateAdminConsumer.ts',
            autoRestart: true,
            watch: false,
            cwd: './src',
            env: {
                NODE_ENV: 'production',
            },
        },
        {
            name: 'create-user-consumer',
            script: 'npx',
            args: 'tsx ./CreateUserConsumer.ts',
            autorestart: true,
            watch: false,
            cwd: './src',
            env: {
                NODE_ENV: 'production',
            },
        },
        {
            name: 'product-embedding-consumer',
            script: 'npx',
            args: 'tsx ./ProductEmbeddingConsumer.ts',
            autorestart: true,
            watch: false,
            cwd: './src',
            env: {
                NODE_ENV: 'production',
            },
        },
        {
            name: 'subscription-consumers',
            script: 'npx',
            args: 'tsx ./SubscriptionConsumers.ts',
            autorestart: true,
            watch: false,
            cwd: './src',
            env: {
                NODE_ENV: 'production',
            },
        },
        {
            name: 'update-admin-consumer',
            script: 'npx',
            args: 'tsx ./UpdateAdminConsumer.ts',
            autorestart: true,
            watch: false,
            cwd: './src',
            env: {
                NODE_ENV: 'production',
            },
        },
        {
            name: 'update-product-consumer',
            script: 'npx',
            args: 'tsx ./UpdateProductConsumer.ts',
            autoRestart: true,
            watch: false,
            cwd: './src',
            env: {
                NODE_ENV: 'production',
            },
        },
        {
            name: 'update-user-cart-consumer',
            script: 'npx',
            args: 'tsx ./UpdateUserCartConsumer.ts',
            autoRestart: true,
            watch: false,
            cwd: './src',
            env: {
                NODE_ENV: 'production',
            },
        },
        {
            name: 'update-user-consumer',
            script: 'npx',
            args: 'tsx ./UpdateUserConsumer.ts',
            autoRestart: true,
            watch: false,
            cwd: './src',
            env: {
                NODE_ENV: 'production',
            },
        },
    ],
};