// Import all consumers directly
import './CreateAdminConsumer';
import './AddProductConsumer';
import './AfterOrderPlaceConsumer';
import './CreateUserConsumer';
import './ProductEmbeddingConsumer';
import './UpdateUserCartConsumer';
import './UpdateUserConsumer';
import './SubscriptionConsumer';

console.log('All Kafka consumers are running...');

// Keep the process running
process.stdin.resume();
