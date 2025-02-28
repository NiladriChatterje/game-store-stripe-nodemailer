import {Kafka} from 'kafkajs'

const kafka = new Kafka({
    clientId:'xv-store',
    brokers:["localhost:9092"],
    ssl:true
});

async function admin(){
    const admin = kafka.admin({
        retry:{
            retries:5
        }
    });
    await admin.connect();
    try{
        //product topic
        const result0:boolean = await admin.createTopics({
            topics:[{topic:"product-topic",numPartitions:5,replicationFactor:3},
            ],
            waitForLeaders:true,
            timeout:60000
        });

        if(!result0)
            throw new Error("<product-topic-creation-failed>");

        //admin-create-topic
        const result1:boolean = await admin.createTopics({
            topics:[{topic:"admin-create-topic",numPartitions:5,replicationFactor:3},
            ],
            waitForLeaders:true,
            timeout:60000
        });

        if(!result1)
            throw new Error("<admin-topic-creation-failed>");

        //admin-update-topic
        const result2:boolean = await admin.createTopics({
            topics:[{topic:"admin-update-topic",numPartitions:5,replicationFactor:3},
            ],
            waitForLeaders:true,
            timeout:60000
        });

        if(!result2)
            throw new Error("<product-topic-creation-failed>");
    }catch(err:Error|any){
        
    }
    await admin.disconnect()
}

admin();