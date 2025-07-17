import { EachMessagePayload, Kafka, Producer } from "kafkajs";

const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ['localhost:9092', 'localhost:9093', 'localhost:9094']
});
async function handleMessage({ partition, topic, message, heartbeat }: EachMessagePayload) {

}
async function main() {

}