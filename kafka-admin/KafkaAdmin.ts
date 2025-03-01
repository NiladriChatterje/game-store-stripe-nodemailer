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
        admin.createTopics({
            topics:[{topic:"product-topic",numPartitions:5,replicationFactor:3},
            ],
            waitForLeaders:true,
            timeout:60000
        }).then((result:boolean)=>{
            if(!result)
                throw new Error("<product-topic-creation-failed>");

        });


        //admin-create-topic
       admin.createTopics({
            topics:[{topic:"admin-create-topic",numPartitions:5,replicationFactor:3},
            ],
            waitForLeaders:true,
            timeout:60000
        }).then((result:boolean)=>{
            if(!result)
                throw new Error("<admin-topic-creation-failed>");

        });

        //admin-update-topic
        admin.createTopics({
            topics:[{topic:"admin-update-topic",numPartitions:5,replicationFactor:3},
            ],
            waitForLeaders:true,
            timeout:60000
        }).then((result:boolean)=>{
            if(!result)
                throw new Error("<product-topic-creation-failed>");
        });


    }catch(err:Error|any){
        console.error(err?.message)
    }
    await admin.disconnect()
}

admin();