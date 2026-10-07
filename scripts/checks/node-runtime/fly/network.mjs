import assert from "node:assert/strict";

// Fixed public DNS endpoints, no private account data. Positive controls precede the policy test.
const program = `
import net from 'node:net';
import dgram from 'node:dgram';
const tcp=(host)=>new Promise(resolve=>{
 const socket=net.createConnection({host,port:443});
 let done=false;const finish=value=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve(value);};
 const timer=setTimeout(()=>finish(false),1200);
 socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));
});
const udp=(host,type)=>new Promise(resolve=>{
 const socket=dgram.createSocket(type);let done=false;
 const finish=value=>{if(done)return;done=true;clearTimeout(timer);socket.close();resolve(value);};
 const timer=setTimeout(()=>finish(false),1200);
 socket.once('error',()=>finish(false));socket.once('message',data=>finish(data.length>=12 && data.readUInt16BE(0)===0x7273));
 socket.send(Buffer.from('727301000001000000000000076578616d706c6503636f6d0000010001','hex'),53,host,error=>{if(error)finish(false);});
});
const [tcp4,tcp6,udp4,udp6]=await Promise.all([tcp('1.1.1.1'),tcp('2606:4700:4700::1111'),udp('1.1.1.1','udp4'),udp('2606:4700:4700::1111','udp6')]);
process.stdout.write(JSON.stringify({tcp4,tcp6,udp4,udp6}));
`;

export async function checkFlyNetwork(machine, expected) {
  const result = JSON.parse(
    await machine.command(["node", "--input-type=module", "-e", program], {
      timeoutMs: 5000,
    }),
  );
  assert.deepEqual(
    result,
    { tcp4: expected, tcp6: expected, udp4: expected, udp6: expected },
    expected
      ? "Network positive control failed; denial cannot be inferred"
      : "Fly policy did not deny the tested direct IPv4/IPv6 TCP/UDP traffic",
  );
  return result;
}
